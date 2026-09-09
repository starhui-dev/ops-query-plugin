import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"
import { maskAccount } from "./privacy.js"
import { formatQuotaAccountReference } from "./quota-account.js"
import { quotaPlatform } from "./quota-platforms.js"

const PAGE_SIZE = 100

// 各平台把额度窗口写在账号快照的不同字段里，这里统一成
// { label, usedPercent, balance, currency, detail, resetAt }。
const WINDOW_EXTRACTORS = {
  openai: extractCodexWindows,
  anthropic: extractClaudeWindows,
  kimi: extractKimiWindows,
  zhipu: extractZhipuWindows,
  deepseek: extractGenericWindows,
  minimax: extractGenericWindows,
  gemini: extractGenericWindows,
  antigravity: extractGenericWindows,
  grok: extractGrokWindows,
}

const REMOTE_QUOTA_PATHS = {
  openai: account => `/api/v1/admin/openai/accounts/${account.id}/quota`,
  grok: account => `/api/v1/admin/grok/accounts/${account.id}/quota`,
  kimi: account => `/api/v1/admin/cn-providers/accounts/${account.id}/quota`,
  zhipu: account => `/api/v1/admin/cn-providers/accounts/${account.id}/quota`,
  deepseek: account => `/api/v1/admin/cn-providers/accounts/${account.id}/balance`,
  minimax: account => `/api/v1/admin/cn-providers/accounts/${account.id}/quota`,
}

export async function listS2aQuotaAccounts(config, fetchImpl) {
  assertServiceConfig("S2A", config, "adminApiKey")
  const accounts = []
  let page = 1
  let pages = 1

  do {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      lite: "true",
    })
    const data = readResponseData(
      await s2aRequest(config, `/api/v1/admin/accounts?${query}`, {}, fetchImpl),
    )
    if (Array.isArray(data.items)) accounts.push(...data.items)
    pages = Math.max(1, Number(data.pages) || 1)
    page += 1
  } while (page <= pages)

  return accounts.filter(isS2aAccount)
}

export async function listS2aQuotaAccountOptions(config, fetchImpl) {
  const accounts = await listS2aQuotaAccounts(config, fetchImpl)
  const results = await queryS2aQuotaAccounts(config, accounts, "Asia/Shanghai", fetchImpl)
  return results.map(result => quotaAccountOption(result.account, result.label))
}

export function buildS2aQuotaAccountOptions(accounts) {
  return accounts
    .filter(isS2aAccount)
    .filter(account => extractSnapshotWindows(account).length > 0)
    .map(account => quotaAccountOption(account, quotaPlatform(account).label))
}

export async function queryS2aQuota(
  config,
  timeZone = "Asia/Shanghai",
  accountIds = [],
  fetchImpl,
) {
  const accounts = selectAccounts(await listS2aQuotaAccounts(config, fetchImpl), accountIds)
  return queryS2aQuotaAccounts(config, accounts, timeZone, fetchImpl)
}

async function queryS2aQuotaAccounts(config, accounts, timeZone, fetchImpl) {
  const results = []

  for (const account of accounts) {
    const result = await buildQuotaResult(config, account, timeZone, fetchImpl)
    if (result) results.push(result)
  }

  return results
}

function quotaAccountOption(account, label) {
  return {
    label: `S2A · ${label || quotaPlatform(account).label} · ${accountDisplayName(account.name, "未命名账号")}`,
    value: formatQuotaAccountReference({
      source: "s2a",
      platform: accountPlatform(account),
      accountId: account.id,
    }),
  }
}

export function formatAccountQuotaResult(result) {
  const title = [
    String(result.source ?? result.account?.source ?? "").toUpperCase(),
    result.label,
    maskedAccountName(result),
  ]
    .filter(Boolean)
    .join(" · ")
  if (result.error) return `${title}\n查询失败  ${singleLine(result.error)}`

  const meta = result.plan ? `\n套餐：${singleLine(result.plan)}` : ""
  const rows = result.windows.map(
    window =>
      `${window.label}  ${formatWindowValue(window)}${formatWindowDetail(window)}  ${formatReset(window.resetAt, result.timeZone)}`,
  )
  return `${title}${meta}\n${rows.length ? rows.join("\n") : "未返回可识别的额度窗口"}`
}

export function formatAccountQuota(results) {
  return ["账号额度", `共 ${results.length} 个账号`, ...results.map(formatAccountQuotaResult)].join(
    "\n\n",
  )
}

export function buildAccountQuotaImageData(results, timeZone = "Asia/Shanghai", now = Date.now()) {
  const successful = results.filter(result => !result.error)
  const percentages = successful.flatMap(getQuotaRemainingPercentages)
  const lowest = percentages.length ? Math.min(...percentages) : null

  return {
    theme: "codex",
    kicker: "ACCOUNT / QUOTA",
    title: "账号额度",
    subtitle: "各平台订阅额度与重置窗口",
    updatedAt: formatImageTime(now, timeZone),
    summary: [
      { label: "账号", value: String(results.length), tone: "info" },
      { label: "可查询", value: String(successful.length), tone: "success" },
      { label: "失败", value: String(results.length - successful.length), tone: "danger" },
      {
        label: "最低剩余",
        value: lowest === null ? "未知" : `${formatNumber(lowest)}%`,
        tone: lowest === null ? "muted" : percentTone(lowest),
      },
    ],
    sections: results.map(result => buildQuotaImageSection(result, timeZone)),
  }
}

export function getQuotaRemainingPercentages(result) {
  if (result?.error || !Array.isArray(result?.windows)) return []
  return result.windows
    .filter(window => window.usedPercent !== null)
    .map(window => clampPercent(100 - window.usedPercent))
}

export function accountPlatform(account) {
  return String(account?.platform ?? "")
    .trim()
    .toLowerCase()
}

async function buildQuotaResult(config, account, timeZone, fetchImpl) {
  const platform = accountPlatform(account)
  const base = {
    source: "s2a",
    platform,
    label: quotaPlatform(account)?.label || platform,
    account: { ...account, source: "s2a" },
    plan: null,
    timeZone,
  }
  const windows = extractSnapshotWindows(account)
  const remote = shouldQueryRemote(account, windows)
    ? await queryRemoteQuota(config, account, timeZone, fetchImpl)
    : null
  if (remote?.windows?.length) return { ...base, ...remote }
  if (windows.length) return { ...base, windows }
  return null
}

function extractSnapshotWindows(account) {
  const platform = accountPlatform(account)
  const extractor = WINDOW_EXTRACTORS[platform] || extractGenericWindows
  return dedupeWindows([
    ...extractor(account),
    ...extractGenericWindows(account),
    ...extractLocalQuotaWindows(account),
  ])
}

function extractKimiWindows(account) {
  const extra = objectValue(account?.extra)
  return [
    percentWindow("5 小时", extra.kimi_5h_used_percent, parseDate(extra.kimi_5h_reset_at)),
    percentWindow("每周", extra.kimi_weekly_used_percent, parseDate(extra.kimi_weekly_reset_at)),
  ].filter(Boolean)
}

function extractZhipuWindows(account) {
  const extra = objectValue(account?.extra)
  return [
    percentWindow("5 小时", extra.zhipu_5h_used_percent, parseDate(extra.zhipu_5h_reset_at)),
  ].filter(Boolean)
}

function extractCodexWindows(account) {
  const extra = objectValue(account?.extra)
  return [
    codexWindow(extra, "codex_5h", "Codex 5 小时", "codex_secondary"),
    codexWindow(extra, "codex_7d", "Codex 每周", "codex_primary"),
  ].filter(Boolean)
}

function codexWindow(extra, prefix, label, legacyPrefix) {
  const minutes = numberValue(extra[`${prefix}_window_minutes`])
  if (minutes !== null && minutes <= 0) return null
  const used = firstDefined(extra[`${prefix}_used_percent`], extra[`${legacyPrefix}_used_percent`])
  const reset = firstDefined(
    extra[`${prefix}_reset_at`],
    extra[`${legacyPrefix}_reset_at`],
    relativeResetDate(extra[`${prefix}_reset_after_seconds`]),
    relativeResetDate(extra[`${legacyPrefix}_reset_after_seconds`]),
  )
  return percentWindow(label, used, parseDate(reset))
}

function extractClaudeWindows(account) {
  const extra = objectValue(account?.extra)
  return [
    ratioWindow("5 小时", extra.session_window_utilization, parseDate(account?.session_window_end)),
    ratioWindow(
      "每周",
      extra.passive_usage_7d_utilization,
      parseUnixSeconds(firstDefined(extra.passive_usage_7d_reset, extra.passive_usage_7d_reset_at)),
    ),
  ].filter(Boolean)
}

function extractGrokWindows(account) {
  const extra = objectValue(account?.extra)
  const windows = []
  const snapshot = objectValue(extra.grok_quota_snapshot)
  for (const [label, value] of [
    ["请求", snapshot.requests ?? snapshot.request],
    ["Token", snapshot.tokens ?? snapshot.token],
  ]) {
    const limit = numberValue(value?.limit)
    const remaining = numberValue(value?.remaining)
    if (limit === null || limit <= 0 || remaining === null) continue
    windows.push({
      label: `Grok ${label}`,
      usedPercent: clampPercent((1 - remaining / limit) * 100),
      resetAt: parseDate(firstDefined(value?.reset_at, value?.resetAt, value?.reset_unix)),
    })
  }
  const billing = objectValue(extra.grok_billing_snapshot)
  const usage = numberValue(firstDefined(billing.usage_percent, billing.used_percent))
  if (usage !== null) {
    windows.push(
      percentWindow(
        "Grok 周期",
        usage,
        parseDate(firstDefined(billing.period_end, billing.billing_period_end)),
      ),
    )
  }
  if (Array.isArray(billing.product_usage)) {
    for (const product of billing.product_usage) {
      const productUsage = numberValue(firstDefined(product?.usage_percent, product?.used_percent))
      if (productUsage !== null) {
        windows.push(
          percentWindow(`${firstString(product?.product) || "产品"}额度`, productUsage, null),
        )
      }
    }
  }
  const prepaid = numberValue(firstDefined(billing.prepaid_balance, billing.prepaidBalance))
  if (prepaid !== null) windows.push(balanceWindow(prepaid, "USD", true))
  const monthlyLimit = numberValue(firstDefined(billing.monthly_limit, billing.monthlyLimit))
  const monthlyUsed = numberValue(firstDefined(billing.monthly_used, billing.monthlyUsed))
  if (monthlyLimit !== null && monthlyLimit > 0 && monthlyUsed !== null) {
    windows.push({
      label: "Grok 每月",
      usedPercent: clampPercent((monthlyUsed / monthlyLimit) * 100),
      detail: `用量 ${formatNumber(monthlyUsed)} / ${formatNumber(monthlyLimit)} USD`,
      resetAt: parseDate(firstDefined(billing.billing_period_end, billing.period_end)),
    })
  }
  const onDemandCap = numberValue(firstDefined(billing.on_demand_cap, billing.onDemandCap))
  const onDemandUsed = numberValue(firstDefined(billing.on_demand_used, billing.onDemandUsed))
  if (onDemandCap !== null && onDemandCap > 0 && onDemandUsed !== null) {
    windows.push({
      label: "Grok 按需",
      usedPercent: clampPercent((onDemandUsed / onDemandCap) * 100),
      detail: `用量 ${formatNumber(onDemandUsed)} / ${formatNumber(onDemandCap)} USD`,
      resetAt: parseDate(firstDefined(billing.billing_period_end, billing.period_end)),
    })
  }
  return [...windows, ...extractGenericWindows(account)]
}

function extractGenericWindows(account) {
  const extra = objectValue(account?.extra)
  const platform = accountPlatform(account)
  const windows = []
  const suffixes = [
    ["5h", "5 小时"],
    ["weekly", "每周"],
    ["7d", "每周"],
    ["daily", "每日"],
    ["monthly", "每月"],
  ]

  for (const [suffix, label] of suffixes) {
    const usedKey = `${platform}_${suffix}_used_percent`
    const utilizationKey = `${platform}_${suffix}_utilization`
    const used = firstDefined(extra[usedKey], extra[utilizationKey])
    const number = numberValue(used)
    if (number === null) continue
    const percent =
      extra[usedKey] === undefined && extra[utilizationKey] !== undefined
        ? number <= 1
          ? number * 100
          : number
        : number
    windows.push(
      percentWindow(
        label,
        percent,
        parseDate(
          firstDefined(
            extra[`${platform}_${suffix}_reset_at`],
            extra[`${platform}_${suffix}_reset`],
          ),
        ),
      ),
    )
  }

  return [...windows, ...extractBalanceWindows(account)]
}

function extractLocalQuotaWindows(account) {
  const extra = objectValue(account?.extra)
  const definitions = [
    ["总额度", "quota_limit", "quota_used", "quota_reset_at"],
    ["每日", "quota_daily_limit", "quota_daily_used", "quota_daily_reset_at"],
    ["每周", "quota_weekly_limit", "quota_weekly_used", "quota_weekly_reset_at"],
  ]
  return definitions
    .map(([label, limitKey, usedKey, resetKey]) => {
      const limit = numberValue(firstDefined(account?.[limitKey], extra[limitKey]))
      const used = numberValue(firstDefined(account?.[usedKey], extra[usedKey]))
      if (limit === null || limit <= 0 || used === null) return null
      return {
        label,
        usedPercent: clampPercent((used / limit) * 100),
        detail: `用量 ${formatNumber(used)} / ${formatNumber(limit)}`,
        resetAt: parseDate(firstDefined(account?.[resetKey], extra[resetKey])),
      }
    })
    .filter(Boolean)
}

function extractBalanceWindows(account) {
  const extra = objectValue(account?.extra)
  const platform = accountPlatform(account)
  const balances = firstDefined(
    extra[`${platform}_balances`],
    extra.balances,
    extra[`${platform}_balance_infos`],
    extra.balance_infos,
  )
  const entries = []

  if (Array.isArray(balances)) {
    for (const entry of balances) {
      const balance = numberValue(
        entry?.balance ?? entry?.amount ?? entry?.total_balance ?? entry?.totalBalance,
      )
      if (balance === null) continue
      entries.push(
        balanceWindow(
          balance,
          firstString(entry?.currency, entry?.unit, extra[`${platform}_balance_currency`]),
          extra[`${platform}_balance_available`],
        ),
      )
    }
  } else if (balances && typeof balances === "object") {
    for (const [currency, value] of Object.entries(balances)) {
      const balance = numberValue(value?.balance ?? value?.amount ?? value)
      if (balance === null) continue
      entries.push(balanceWindow(balance, currency, extra[`${platform}_balance_available`]))
    }
  }

  if (!entries.length) {
    const balance = numberValue(firstDefined(extra[`${platform}_balance`], extra.balance))
    if (balance !== null) {
      entries.push(
        balanceWindow(
          balance,
          firstString(extra[`${platform}_balance_currency`], extra.balance_currency),
          extra[`${platform}_balance_available`],
        ),
      )
    }
  }
  return entries
}

function balanceWindow(balance, currency, available) {
  return {
    label: currency ? `余额 ${currency}` : "余额",
    usedPercent: null,
    balance,
    currency: currency || "",
    available: available === undefined ? true : Boolean(available),
    resetAt: null,
  }
}

function dedupeWindows(windows) {
  const seen = new Set()
  return windows.filter(window => {
    if (!window) return false
    const key = `${window.label}|${window.balance ?? ""}|${window.usedPercent ?? ""}|${window.detail ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function shouldQueryRemote(account, snapshotWindows) {
  const platform = accountPlatform(account)
  if (!REMOTE_QUOTA_PATHS[platform]) return false
  if (snapshotWindows.length === 0) return true
  return ["openai", "grok"].includes(platform) && isOAuth(account)
}

async function queryRemoteQuota(config, account, timeZone, fetchImpl) {
  const platform = accountPlatform(account)
  const pathBuilder = REMOTE_QUOTA_PATHS[platform]
  if (!pathBuilder) return null

  const paths = [pathBuilder(account)]
  if (platform === "kimi") {
    paths.push(`/api/v1/admin/cn-providers/accounts/${account.id}/balance`)
  }

  for (const path of paths) {
    try {
      const data = readResponseData(await s2aRequest(config, path, {}, fetchImpl))
      const parsed = parseRemoteQuota(data, account, path, timeZone)
      if (parsed.windows.length) return parsed
    } catch {
      // 不支持该账号类型或额度接口暂不可用时，继续尝试其它数据源。
    }
  }
  return null
}

function parseRemoteQuota(data, account, path, timeZone) {
  if (data?.success === false || firstString(data?.error)) {
    return { plan: null, timeZone, windows: [] }
  }
  const isBalance = path.endsWith("/balance")
  if (isBalance) {
    return { plan: null, windows: extractRemoteBalanceWindows(data, account) }
  }

  if (data?.snapshot || data?.billing) {
    const grokAccount = {
      platform: "grok",
      extra: {
        grok_quota_snapshot: data.snapshot,
        grok_billing_snapshot: data.billing,
      },
    }
    return {
      plan: firstString(data?.billing?.plan, data?.snapshot?.subscription_tier) || null,
      timeZone,
      windows: extractGrokWindows(grokAccount),
    }
  }

  const tiers = Array.isArray(data?.tiers) ? data.tiers : []
  const windows = tiers.length ? extractTierWindows(tiers) : quotaWindows(data)
  return {
    plan: firstString(data?.plan_type, data?.planType, data?.plan_level, data?.planLevel) || null,
    timeZone,
    windows,
  }
}

function extractTierWindows(tiers) {
  return tiers
    .map(tier => {
      const used = numberValue(
        firstDefined(tier?.used_percent, tier?.usedPercent, tier?.utilization),
      )
      if (used === null) return null
      const percent =
        tier?.utilization !== undefined && tier?.used_percent === undefined
          ? used <= 1
            ? used * 100
            : used
          : used
      const window = String(tier?.window ?? tier?.label ?? "").toLowerCase()
      const label = window.includes("week") || window.includes("7d") ? "每周" : "5 小时"
      return percentWindow(label, percent, parseDate(firstDefined(tier?.reset_at, tier?.resetAt)))
    })
    .filter(Boolean)
}

function quotaWindows(quota) {
  const windows = []
  for (const [label, limit] of quotaGroups(quota)) {
    for (const window of rateLimitWindows(limit)) {
      let used = numberValue(firstDefined(window.used_percent, window.usedPercent))
      if (
        used === null &&
        (limit?.limit_reached === true || limit?.limitReached === true || limit?.allowed === false)
      ) {
        used = 100
      }
      if (used === null) continue
      windows.push({
        label: `${label} ${windowLabel(numberValue(firstDefined(window.limit_window_seconds, window.limitWindowSeconds)))}`,
        usedPercent: clampPercent(used),
        resetAt: quotaResetDate(window),
      })
    }
  }
  return windows
}

function quotaGroups(quota) {
  const groups = [["Codex", quota?.rate_limit ?? quota?.rateLimit]]
  if (Array.isArray(quota?.additional_rate_limits ?? quota?.additionalRateLimits)) {
    for (const item of quota.additional_rate_limits ?? quota.additionalRateLimits) {
      groups.push([
        firstString(
          item?.limit_name,
          item?.limitName,
          item?.metered_feature,
          item?.meteredFeature,
        ) || "附加额度",
        item?.rate_limit ?? item?.rateLimit,
      ])
    }
  }
  return groups.filter(([, limit]) => limit && typeof limit === "object")
}

function rateLimitWindows(limit) {
  return [
    limit?.primary_window ?? limit?.primaryWindow,
    limit?.secondary_window ?? limit?.secondaryWindow,
  ].filter(window => window && typeof window === "object")
}

function quotaResetDate(window) {
  const direct = firstDefined(window?.reset_at, window?.resetAt)
  if (direct !== undefined && direct !== null && direct !== "") {
    const numeric = numberValue(direct)
    return validDate(
      numeric === null ? new Date(direct) : new Date(numeric < 1e12 ? numeric * 1000 : numeric),
    )
  }
  const after = numberValue(firstDefined(window?.reset_after_seconds, window?.resetAfterSeconds))
  return after === null ? null : validDate(new Date(Date.now() + after * 1000))
}

function extractRemoteBalanceWindows(data, account) {
  if (data?.success === false || firstString(data?.error)) return []
  const platform = accountPlatform(account)
  const balances = firstDefined(data?.balances, data?.Balances, data?.balance_infos)
  const entries = []
  if (Array.isArray(balances)) {
    for (const entry of balances) {
      const balance = numberValue(
        firstDefined(entry?.balance, entry?.amount, entry?.total_balance, entry?.totalBalance),
      )
      if (balance === null) continue
      entries.push(
        balanceWindow(
          balance,
          firstString(entry?.currency, entry?.unit, data?.currency) || "",
          data?.available,
        ),
      )
    }
  } else if (balances && typeof balances === "object") {
    for (const [currency, value] of Object.entries(balances)) {
      const balance = numberValue(value?.balance ?? value?.amount ?? value)
      if (balance === null) continue
      entries.push(balanceWindow(balance, currency, data?.available))
    }
  }
  if (!entries.length) {
    const balance = numberValue(firstDefined(data?.balance, data?.Balance, data?.available_balance))
    if (balance !== null) {
      entries.push(
        balanceWindow(
          balance,
          firstString(data?.currency) || (platform === "kimi" ? "CNY" : ""),
          data?.available,
        ),
      )
    }
  }
  return entries
}

function percentWindow(label, usedPercent, resetAt) {
  const used = numberValue(usedPercent)
  return used === null ? null : { label, usedPercent: clampPercent(used), resetAt }
}

function ratioWindow(label, utilization, resetAt) {
  const ratio = numberValue(utilization)
  return ratio === null
    ? null
    : { label, usedPercent: clampPercent(ratio <= 1 ? ratio * 100 : ratio), resetAt }
}

function relativeResetDate(value) {
  const seconds = numberValue(value)
  return seconds === null ? undefined : Date.now() + seconds * 1000
}

function buildQuotaImageSection(result, timeZone) {
  const title = maskedAccountName(result)
  const subtitle = accountTypeLabel(result.account)
  if (result.error) {
    return {
      title,
      kind: result.label,
      subtitle,
      badge: "查询失败",
      badgeTone: "danger",
      rows: [
        {
          label: "错误信息",
          value: singleLine(result.error),
          tone: "danger",
          wide: true,
        },
      ],
    }
  }

  const rows = result.windows.map(window => {
    const remaining = window.usedPercent === null ? null : clampPercent(100 - window.usedPercent)
    return {
      label: window.label,
      value: formatWindowValue(window),
      detail: [singleLine(window.detail).trim(), formatReset(window.resetAt, timeZone)]
        .filter(Boolean)
        .join("｜"),
      progress: remaining,
      tone:
        remaining === null
          ? window.available === false
            ? "danger"
            : "info"
          : percentTone(remaining),
    }
  })

  return {
    title,
    kind: result.label,
    subtitle,
    badge: result.plan ? singleLine(result.plan).toUpperCase() : "可用",
    badgeTone: "success",
    rows: rows.length
      ? rows
      : [{ label: "额度窗口", value: "暂不可用", tone: "muted", wide: true }],
  }
}

function selectAccounts(accounts, accountIds) {
  const selected = new Set(accountIds.map(String).filter(Boolean))
  return selected.size ? accounts.filter(account => selected.has(String(account.id))) : accounts
}

function isS2aAccount(account) {
  const id = Number(account?.id)
  return Number.isSafeInteger(id) && id > 0 && Boolean(accountPlatform(account))
}

async function s2aRequest(config, path, options = {}, fetchImpl) {
  return requestJson(
    new URL(path, `${config.baseUrl}/`),
    {
      ...options,
      headers: {
        "x-api-key": config.adminApiKey,
        ...options.headers,
      },
    },
    config.timeoutMs,
    fetchImpl,
  )
}

function readResponseData(payload) {
  if (Number(payload?.code ?? 0) !== 0) {
    throw new Error(String(payload?.message || "S2A 返回业务错误"))
  }
  return objectValue(payload?.data)
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function accountTypeLabel(account) {
  const source = String(account?.source ?? "").toUpperCase()
  const rawType = String(account?.type ?? "").toLowerCase()
  const type = rawType === "oauth" ? "OAuth" : rawType === "apikey" ? "Key" : rawType || "账号"
  return [source, type, "账号"].filter(Boolean).join(" ")
}

function maskedAccountName(result) {
  return accountDisplayName(result?.account?.name, "未命名账号")
}

function accountDisplayName(value, fallback) {
  const name = singleLine(value).trim()
  if (!name) return fallback
  return name.includes("@") ? maskAccount(name) : name
}

function formatRemaining(window) {
  if (window.usedPercent === null || window.usedPercent === undefined) return "未知"
  return `${formatNumber(clampPercent(100 - window.usedPercent))}%`
}

function formatWindowValue(window) {
  if (window.usedPercent !== null && window.usedPercent !== undefined) {
    return `剩余 ${formatRemaining(window)}`
  }
  if (window.balance !== undefined && window.balance !== null) {
    const currency = String(window.currency ?? "").trim()
    return currency ? `${currency} ${formatNumber(window.balance)}` : formatNumber(window.balance)
  }
  return "未知"
}

function formatWindowDetail(window) {
  const detail = singleLine(window?.detail).trim()
  return detail ? `  ${detail}` : ""
}

function formatReset(date, timeZone) {
  if (!date) return "重置时间未知"
  return `重置于 ${new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)}`
}

function parseDate(value) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "number") {
    return validDate(new Date(value < 1e12 ? value * 1000 : value))
  }
  return validDate(new Date(value))
}

function parseUnixSeconds(value) {
  const seconds = numberValue(value)
  return seconds === null ? null : validDate(new Date(seconds * 1000))
}

function validDate(date) {
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function percentTone(value) {
  if (value < 10) return "danger"
  if (value < 30) return "warning"
  return "success"
}

function formatImageTime(value, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "")
}

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ")
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "")
}

function firstString(...values) {
  const value = values.find(item => item !== undefined && item !== null && String(item).trim())
  return value === undefined ? "" : String(value).trim()
}

function isOAuth(account) {
  return String(account?.type ?? "").toLowerCase() === "oauth"
}

function windowLabel(seconds) {
  if (seconds === 18000) return "5 小时"
  if (seconds === 604800) return "每周"
  if (seconds !== null && seconds !== undefined && seconds >= 28 * 86400 && seconds <= 31 * 86400) {
    return "每月"
  }
  if (seconds !== null && seconds !== undefined)
    return `${Math.round((seconds / 3600) * 10) / 10} 小时`
  return "额度"
}
