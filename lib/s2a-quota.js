import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"
import { maskAccount } from "./privacy.js"
import { quotaPlatform } from "./quota-platforms.js"

const PAGE_SIZE = 100

// 各平台把额度窗口写在账号快照的不同字段里，这里统一成 { label, usedPercent, resetAt }。
const WINDOW_EXTRACTORS = {
  openai: extractCodexWindows,
  anthropic: extractClaudeWindows,
  kimi: extractKimiWindows,
  zhipu: extractZhipuWindows,
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

  return accounts.filter(isQuotaAccount)
}

export async function listS2aQuotaAccountOptions(config, fetchImpl) {
  return buildS2aQuotaAccountOptions(await listS2aQuotaAccounts(config, fetchImpl))
}

export function buildS2aQuotaAccountOptions(accounts) {
  return accounts.filter(isQuotaAccount).map(account => ({
    label: `${quotaPlatform(account).label} · ${accountDisplayName(account.name, "未命名账号")}`,
    value: `${accountPlatform(account)}:${account.id}`,
  }))
}

export async function queryS2aQuota(
  config,
  timeZone = "Asia/Shanghai",
  accountIds = [],
  fetchImpl,
) {
  const accounts = selectAccounts(await listS2aQuotaAccounts(config, fetchImpl), accountIds)
  const results = []

  for (const account of accounts) {
    const result = await buildQuotaResult(config, account, timeZone, fetchImpl)
    if (result.error || result.windows.length) results.push(result)
  }

  return results
}

export function formatS2aQuotaResult(result) {
  const title = `${result.label} · ${maskedAccountName(result)}`
  if (result.error) return `${title}\n查询失败  ${singleLine(result.error)}`

  const meta = result.plan ? `\n套餐：${singleLine(result.plan)}` : ""
  const rows = result.windows.map(
    window =>
      `${window.label}  剩余 ${formatRemaining(window)}  ${formatReset(window.resetAt, result.timeZone)}`,
  )
  return `${title}${meta}\n${rows.length ? rows.join("\n") : "未返回可识别的额度窗口"}`
}

export function formatS2aQuota(results) {
  return ["S2A 账号额度", `共 ${results.length} 个账号`, ...results.map(formatS2aQuotaResult)].join(
    "\n\n",
  )
}

export function buildS2aQuotaImageData(results, timeZone = "Asia/Shanghai", now = Date.now()) {
  const successful = results.filter(result => !result.error)
  const percentages = successful.flatMap(getS2aQuotaRemainingPercentages)
  const lowest = percentages.length ? Math.min(...percentages) : null

  return {
    theme: "codex",
    kicker: "S2A / QUOTA",
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

export function getS2aQuotaRemainingPercentages(result) {
  if (result?.error || !Array.isArray(result?.windows)) return []
  return result.windows
    .filter(window => window.usedPercent !== null)
    .map(window => clampPercent(100 - window.usedPercent))
}

export function accountPlatform(account) {
  return String(account?.platform ?? "").toLowerCase()
}

async function buildQuotaResult(config, account, timeZone, fetchImpl) {
  const platform = accountPlatform(account)
  const base = { platform, label: quotaPlatform(account).label, account, plan: null, timeZone }

  if (platform !== "openai") {
    return { ...base, windows: WINDOW_EXTRACTORS[platform](account) }
  }

  // Codex 的详细额度（附加限额、套餐）只有专用接口提供，失败时退回账号快照。
  try {
    const quota = readResponseData(
      await s2aRequest(config, `/api/v1/admin/openai/accounts/${account.id}/quota`, {}, fetchImpl),
    )
    return {
      ...base,
      plan: quota.plan_type ? singleLine(quota.plan_type) : null,
      windows: quotaWindows(quota),
    }
  } catch (error) {
    const windows = extractCodexWindows(account)
    if (!windows.length) return { ...base, windows: [], error: errorMessage(error) }
    return { ...base, windows }
  }
}

function quotaWindows(quota) {
  const windows = []
  for (const [label, limit] of quotaGroups(quota)) {
    for (const window of rateLimitWindows(limit)) {
      windows.push({
        label: `${label} ${windowLabel(numberValue(window.limit_window_seconds))}`,
        usedPercent: numberValue(window.used_percent),
        resetAt: quotaResetDate(window),
      })
    }
  }
  return windows
}

function quotaGroups(quota) {
  const groups = [["Codex", quota?.rate_limit]]
  if (Array.isArray(quota?.additional_rate_limits)) {
    for (const item of quota.additional_rate_limits) {
      groups.push([
        singleLine(item?.limit_name || item?.metered_feature || "附加额度"),
        item?.rate_limit,
      ])
    }
  }
  return groups.filter(([, limit]) => limit && typeof limit === "object")
}

function rateLimitWindows(limit) {
  return [limit?.primary_window, limit?.secondary_window].filter(
    window => window && typeof window === "object",
  )
}

function quotaResetDate(window) {
  const direct = window.reset_at
  if (direct !== undefined && direct !== null && direct !== "") {
    const numeric = numberValue(direct)
    return validDate(
      numeric === null ? new Date(direct) : new Date(numeric < 1e12 ? numeric * 1000 : numeric),
    )
  }
  const after = numberValue(window.reset_after_seconds)
  return after === null ? null : validDate(new Date(Date.now() + after * 1000))
}

function extractCodexWindows(account) {
  const extra = objectValue(account?.extra)
  return [
    codexWindow(extra, "codex_5h", "Codex 5 小时"),
    codexWindow(extra, "codex_7d", "Codex 每周"),
  ].filter(Boolean)
}

function codexWindow(extra, prefix, label) {
  // window_minutes 为 0 表示当前没有该窗口的快照，此时百分比也没有意义。
  if (!numberValue(extra[`${prefix}_window_minutes`])) return null
  return {
    label,
    usedPercent: numberValue(extra[`${prefix}_used_percent`]),
    resetAt: parseDate(extra[`${prefix}_reset_at`]),
  }
}

function extractClaudeWindows(account) {
  const extra = objectValue(account?.extra)
  return [
    ratioWindow("5 小时", extra.session_window_utilization, parseDate(account?.session_window_end)),
    ratioWindow(
      "每周",
      extra.passive_usage_7d_utilization,
      parseUnixSeconds(extra.passive_usage_7d_reset),
    ),
  ].filter(Boolean)
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

function percentWindow(label, usedPercent, resetAt) {
  const used = numberValue(usedPercent)
  return used === null ? null : { label, usedPercent: clampPercent(used), resetAt }
}

// Anthropic 的快照用 0~1 的小数表示占用比例。
function ratioWindow(label, utilization, resetAt) {
  const ratio = numberValue(utilization)
  return ratio === null ? null : { label, usedPercent: clampPercent(ratio * 100), resetAt }
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
      value: remaining === null ? "未知" : `${formatNumber(remaining)}%`,
      detail: formatReset(window.resetAt, timeZone),
      progress: remaining,
      tone: remaining === null ? "muted" : percentTone(remaining),
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

function isQuotaAccount(account) {
  const id = Number(account?.id)
  const platform = quotaPlatform(account)
  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    Boolean(platform) &&
    platform.types.includes(String(account?.type ?? "").toLowerCase())
  )
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
  return String(account?.type ?? "").toLowerCase() === "oauth" ? "S2A OAuth 账号" : "S2A Key 账号"
}

function maskedAccountName(result) {
  return accountDisplayName(result?.account?.name, "未命名账号")
}

function accountDisplayName(value, fallback) {
  const name = singleLine(value).trim()
  if (!name) return fallback
  return name.includes("@") ? maskAccount(name) : name
}

function windowLabel(seconds) {
  if (seconds === 18000) return "5 小时"
  if (seconds === 604800) return "每周"
  if (seconds !== null && seconds >= 28 * 86400 && seconds <= 31 * 86400) return "每月"
  if (seconds !== null) return `${Math.round((seconds / 3600) * 10) / 10} 小时`
  return "额度"
}

function formatRemaining(window) {
  if (window.usedPercent === null) return "未知"
  return `${formatNumber(clampPercent(100 - window.usedPercent))}%`
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
