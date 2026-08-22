import { assertServiceConfig } from "./config.js"
import { HttpError, requestJson } from "./http.js"
import {
  formatQuotaAccountReference,
  parseQuotaAccountReference,
  quotaAccountKey,
} from "./quota-account.js"
import { cpaQuotaPlatform, normalizeCpaProvider } from "./quota-platforms.js"

const API_HEADERS = {
  antigravity: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
  },
  claude: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "anthropic-beta": "oauth-2025-04-20",
  },
  codex: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
  },
  kimi: { Authorization: "Bearer $TOKEN$" },
  xai: {
    Authorization: "Bearer $TOKEN$",
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": "0.2.91",
    accept: "*/*",
    "user-agent": "grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)",
  },
}

const ANTIGRAVITY_QUOTA_URLS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
]
const ANTIGRAVITY_SUBSCRIPTION_URL =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile"
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages"
const XAI_BILLING_WEEKLY_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
const XAI_BILLING_MONTHLY_URL = "https://cli-chat-proxy.grok.com/v1/billing"

const PROVIDER_QUERIES = {
  antigravity: queryAntigravityQuota,
  claude: queryClaudeQuota,
  codex: queryCodexQuota,
  kimi: queryKimiQuota,
  xai: queryXaiQuota,
}

export async function listCpaQuotaAccounts(config, fetchImpl) {
  const files = getCpaQuotaFiles(await fetchCpaAuthFiles(config, fetchImpl))
  return files.map(file => {
    const platform = normalizeCpaProvider(file?.provider ?? file?.type)
    return {
      label: `CPA · ${cpaQuotaPlatform({ provider: platform }).label} · ${accountName(file)}`,
      value: formatQuotaAccountReference({
        source: "cpa",
        platform,
        accountId: authIndex(file),
      }),
    }
  })
}

export async function queryCpaQuota(config, timeZone = "Asia/Shanghai", accounts = [], fetchImpl) {
  const files = selectCpaQuotaFiles(
    getCpaQuotaFiles(await fetchCpaAuthFiles(config, fetchImpl)),
    accounts,
  )
  return Promise.all(files.map(file => buildCpaQuotaResult(config, file, timeZone, fetchImpl)))
}

export function getCpaQuotaFiles(files) {
  return files.filter(file => {
    const provider = normalizeCpaProvider(file?.provider ?? file?.type)
    return Boolean(cpaQuotaPlatform({ provider })) && !isDisabled(file) && Boolean(authIndex(file))
  })
}

export function getProviderAuthFiles(files, provider, authIndexes = []) {
  const normalizedProvider = normalizeCpaProvider(provider)
  const selected = new Set(authIndexes.map(String).filter(Boolean))
  return getCpaQuotaFiles(files).filter(file => {
    const index = authIndex(file)
    return (
      normalizeCpaProvider(file?.provider ?? file?.type) === normalizedProvider &&
      (!selected.size || selected.has(index))
    )
  })
}

export function parseApiCallResult(result, providerLabel = "上游") {
  const status = Number(result?.status_code ?? result?.statusCode ?? 0)
  if (status < 200 || status >= 300) {
    const reason = apiCallErrorReason(result)
    if (status === 401 && reason === "REASON_INVALID_AUTH_TOKEN") {
      throw new HttpError("Codex 凭据已失效（401），请重新登录账号", status)
    }
    const detail = apiCallErrorMessage(result)
    const suffix = detail ? `：${detail}` : reason ? `（${reason}）` : ""
    throw new HttpError(
      `${providerLabel} 配额接口返回 HTTP ${status || "未知状态"}${suffix}`,
      status,
    )
  }

  const body = result?.body ?? result?.bodyText
  if (body && typeof body === "object") return body
  if (typeof body !== "string" || !body.trim()) throw new Error(`${providerLabel} 配额接口返回为空`)
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${providerLabel} 配额接口返回的不是 JSON`)
  }
}

async function buildCpaQuotaResult(config, file, timeZone, fetchImpl) {
  const platform = normalizeCpaProvider(file?.provider ?? file?.type)
  const descriptor = cpaQuotaPlatform({ provider: platform })
  const account = {
    id: authIndex(file),
    name: accountName(file),
    platform,
    type: "oauth",
    source: "cpa",
  }
  const base = {
    source: "cpa",
    platform,
    label: descriptor.label,
    account,
    plan: null,
    timeZone,
  }

  try {
    const quota = await PROVIDER_QUERIES[platform](config, file, fetchImpl)
    if (!quota.windows.length) throw new Error(`${descriptor.label} 未返回可识别的额度`)
    return { ...base, ...quota }
  } catch (error) {
    return { ...base, windows: [], error: errorMessage(error) }
  }
}

async function queryCodexQuota(config, file, fetchImpl) {
  const headers = { ...API_HEADERS.codex }
  const accountId = resolveCodexAccountId(file)
  if (accountId) headers["Chatgpt-Account-Id"] = accountId
  const payload = await apiCallPayload(
    config,
    file,
    { method: "GET", url: CODEX_USAGE_URL, header: headers },
    fetchImpl,
    "Codex",
  )
  return {
    plan: payload.plan_type ?? payload.planType ?? resolveCodexPlan(file),
    windows: buildCodexWindows(payload),
  }
}

async function queryClaudeQuota(config, file, fetchImpl) {
  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallPayload(
      config,
      file,
      { method: "GET", url: CLAUDE_USAGE_URL, header: API_HEADERS.claude },
      fetchImpl,
      "Claude",
    ),
    apiCallPayload(
      config,
      file,
      { method: "GET", url: CLAUDE_PROFILE_URL, header: API_HEADERS.claude },
      fetchImpl,
      "Claude",
    ),
  ])
  if (usageResult.status === "rejected") throw usageResult.reason
  return {
    plan: profileResult.status === "fulfilled" ? resolveClaudePlan(profileResult.value) : null,
    windows: buildClaudeWindows(usageResult.value),
  }
}

async function queryKimiQuota(config, file, fetchImpl) {
  const payload = await apiCallPayload(
    config,
    file,
    { method: "GET", url: KIMI_USAGE_URL, header: API_HEADERS.kimi },
    fetchImpl,
    "Kimi",
  )
  return { plan: null, windows: buildKimiWindows(payload) }
}

async function queryAntigravityQuota(config, file, fetchImpl) {
  const projectId = resolveProjectId(file)
  if (!projectId) throw new Error("Antigravity 账号缺少 project_id")
  const data = JSON.stringify({ project: projectId })
  let lastError = null

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const payload = await apiCallPayload(
        config,
        file,
        { method: "POST", url, header: API_HEADERS.antigravity, data },
        fetchImpl,
        "Antigravity",
      )
      const windows = buildAntigravityWindows(payload)
      if (windows.length) {
        const plan = await queryAntigravityPlan(config, file, fetchImpl).catch(() => null)
        return { plan, windows }
      }
      lastError = new Error("Antigravity 未返回可识别的额度")
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error("Antigravity 配额查询失败")
}

async function queryAntigravityPlan(config, file, fetchImpl) {
  const payload = await apiCallPayload(
    config,
    file,
    {
      method: "POST",
      url: ANTIGRAVITY_SUBSCRIPTION_URL,
      header: API_HEADERS.antigravity,
      data: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
    },
    fetchImpl,
    "Antigravity",
  )
  const paidTier = objectValue(payload.paidTier ?? payload.paid_tier)
  const currentTier = objectValue(payload.currentTier ?? payload.current_tier)
  const tier = paidTier.id ? paidTier : currentTier
  const name = singleLine(tier.name).trim()
  if (name) return name
  return {
    "free-tier": "Free",
    "g1-pro-tier": "Pro",
    "g1-ultra-tier": "Ultra",
    "g1-ultra-lite-tier": "Ultra Lite",
  }[String(tier.id)]
}

async function queryXaiQuota(config, file, fetchImpl) {
  const headers = buildXaiHeaders(file)
  const settled = await Promise.allSettled([
    apiCallPayload(
      config,
      file,
      { method: "GET", url: XAI_BILLING_WEEKLY_URL, header: headers },
      fetchImpl,
      "xAI",
    ),
    apiCallPayload(
      config,
      file,
      { method: "GET", url: XAI_BILLING_MONTHLY_URL, header: headers },
      fetchImpl,
      "xAI",
    ),
  ])
  const payloads = settled
    .filter(result => result.status === "fulfilled")
    .map(result => result.value)
  const windows = buildXaiWindows(payloads)
  if (!windows.length) {
    const failed = settled.find(result => result.status === "rejected")
    if (failed) throw failed.reason
  }
  return { plan: null, windows }
}

function buildCodexWindows(quota) {
  const windows = []
  for (const [label, limit] of codexQuotaGroups(quota)) {
    const limitReached =
      Boolean(limit.limit_reached ?? limit.limitReached) || limit.allowed === false
    for (const window of rateLimitWindows(limit)) {
      let usedPercent = numberValue(window.used_percent ?? window.usedPercent)
      if (usedPercent === null && limitReached) usedPercent = 100
      windows.push({
        label: `${label} ${windowLabel(numberValue(window.limit_window_seconds ?? window.limitWindowSeconds))}`,
        usedPercent,
        resetAt: quotaResetDate(window),
      })
    }
  }
  return windows
}

function codexQuotaGroups(quota) {
  const groups = [
    ["Codex", quota?.rate_limit ?? quota?.rateLimit],
    ["代码审查", quota?.code_review_rate_limit ?? quota?.codeReviewRateLimit],
  ]
  const additional = quota?.additional_rate_limits ?? quota?.additionalRateLimits
  if (Array.isArray(additional)) {
    for (const item of additional) {
      groups.push([
        singleLine(
          item?.limit_name ??
            item?.limitName ??
            item?.metered_feature ??
            item?.meteredFeature ??
            "附加额度",
        ),
        item?.rate_limit ?? item?.rateLimit,
      ])
    }
  }
  return groups.filter(([, limit]) => limit && typeof limit === "object")
}

function buildClaudeWindows(payload) {
  const windows = []
  const fable = findClaudeFableLimit(payload)
  const definitions = [
    ["five_hour", "5 小时"],
    ["seven_day", "每周"],
    ["seven_day_oauth_apps", "OAuth 应用每周"],
    ["seven_day_opus", "Opus 每周"],
    ["seven_day_sonnet", "Sonnet 每周"],
    ["seven_day_cowork", "Cowork 每周"],
    ["iguana_necktie", "Fable 每周"],
  ]
  for (const [key, label] of definitions) {
    if (key === "iguana_necktie" && fable) continue
    const window = objectValue(payload?.[key])
    const usedPercent = numberValue(window.utilization)
    if (usedPercent === null) continue
    windows.push({
      label,
      usedPercent: clampPercent(usedPercent),
      resetAt: parseDate(window.resets_at),
    })
  }
  if (fable) {
    windows.push({
      label: "Fable 每周",
      usedPercent: clampPercent(numberValue(fable.percent)),
      resetAt: parseDate(fable.resets_at),
    })
  }
  const extra = objectValue(payload?.extra_usage)
  if (booleanValue(extra.is_enabled)) {
    const limit = numberValue(extra.monthly_limit)
    const used = numberValue(extra.used_credits)
    const utilization = numberValue(extra.utilization)
    const usedPercent =
      utilization ?? (limit !== null && limit > 0 && used !== null ? (used / limit) * 100 : null)
    windows.push({
      label: "额外用量",
      usedPercent: usedPercent === null ? null : clampPercent(usedPercent),
      resetAt: null,
      detail:
        used !== null && limit !== null
          ? `${formatCurrencyCents(used)} / ${formatCurrencyCents(limit)}`
          : undefined,
    })
  }
  return windows
}

function buildKimiWindows(payload) {
  const windows = []
  if (Array.isArray(payload?.limits)) {
    payload.limits.forEach((item, index) => {
      const detail = objectValue(item?.detail)
      const data = Object.keys(detail).length ? { ...item, ...detail } : objectValue(item)
      const window = objectValue(item?.window)
      const parsed = buildKimiWindow(data, window, index)
      if (parsed) windows.push(parsed)
    })
  }
  const usage = objectValue(payload?.usage)
  const summary = buildKimiWindow(usage, {}, windows.length, "每周额度")
  if (summary) windows.push(summary)
  return windows
}

function buildKimiWindow(data, window, index, fallbackLabel = "") {
  const limit = numberValue(data.limit)
  let used = numberValue(data.used)
  const remaining = numberValue(data.remaining)
  if (used === null && remaining !== null && limit !== null) used = limit - remaining
  if (used === null && limit === null) return null
  const label =
    firstString(data.name, data.title, data.scope) ||
    kimiWindowLabel(window.duration ?? data.duration, window.timeUnit ?? data.timeUnit) ||
    fallbackLabel ||
    `额度 ${index + 1}`
  const usedPercent =
    limit !== null && limit > 0 && used !== null
      ? (used / limit) * 100
      : (used ?? 0) > 0
        ? 100
        : null
  return {
    label,
    usedPercent: usedPercent === null ? null : clampPercent(usedPercent),
    resetAt: kimiResetDate(data),
    detail: limit !== null ? `用量 ${formatNumber(used ?? 0)} / ${formatNumber(limit)}` : undefined,
  }
}

function buildAntigravityWindows(value) {
  const payload = parseNestedPayload(value)
  const groups = Array.isArray(payload?.groups) ? payload.groups : []
  const windows = []
  groups.forEach((group, groupIndex) => {
    const groupName =
      firstString(group?.displayName, group?.display_name) || `额度组 ${groupIndex + 1}`
    const buckets = Array.isArray(group?.buckets) ? group.buckets : []
    buckets.forEach((bucket, bucketIndex) => {
      const remaining = quotaFraction(bucket?.remainingFraction ?? bucket?.remaining_fraction)
      if (remaining === null) return
      const bucketName =
        firstString(bucket?.displayName, bucket?.display_name, bucket?.window) ||
        `额度 ${bucketIndex + 1}`
      windows.push({
        label: `${groupName} · ${bucketName}`,
        usedPercent: clampPercent(100 - remaining * 100),
        resetAt: parseDate(bucket?.resetTime ?? bucket?.reset_time),
      })
    })
  })
  return windows
}

function buildXaiWindows(payloads) {
  const windows = new Map()
  for (const payload of payloads) {
    const config = objectValue(payload?.config)
    const period = objectValue(config.currentPeriod ?? config.current_period)
    const periodType = String(period.type ?? "").toLowerCase()
    const resetAt = parseDate(period.end ?? config.billingPeriodEnd ?? config.billing_period_end)
    const usagePercent = numberValue(config.creditUsagePercent ?? config.credit_usage_percent)
    if (usagePercent !== null) {
      addXaiWindow(windows, {
        label: periodType.includes("month") ? "每月额度" : "每周额度",
        usedPercent: clampPercent(usagePercent),
        resetAt,
      })
    }
    const products = config.productUsage ?? config.product_usage
    if (Array.isArray(products)) {
      products.forEach((product, index) => {
        const productPercent = numberValue(product?.usagePercent ?? product?.usage_percent)
        if (productPercent === null) return
        addXaiWindow(windows, {
          label: `${firstString(product?.product) || `产品 ${index + 1}`}额度`,
          usedPercent: clampPercent(productPercent),
          resetAt,
        })
      })
    }
    const monthlyLimit = centValue(config.monthlyLimit ?? config.monthly_limit)
    const used = centValue(config.used)
    if (monthlyLimit !== null && monthlyLimit > 0 && used !== null) {
      addXaiWindow(windows, {
        label: "每月额度",
        usedPercent: clampPercent((Math.min(used, monthlyLimit) / monthlyLimit) * 100),
        resetAt: parseDate(config.billingPeriodEnd ?? config.billing_period_end ?? period.end),
        detail: `${formatCurrencyCents(Math.min(used, monthlyLimit))} / ${formatCurrencyCents(monthlyLimit)}`,
      })
    }
    const onDemandCap = centValue(config.onDemandCap ?? config.on_demand_cap)
    const explicitOnDemandUsed = centValue(config.onDemandUsed ?? config.on_demand_used)
    const onDemandUsed =
      explicitOnDemandUsed ??
      (used !== null && monthlyLimit !== null ? Math.max(0, used - monthlyLimit) : null)
    if (onDemandCap !== null && onDemandCap > 0 && onDemandUsed !== null) {
      addXaiWindow(windows, {
        label: "按需额度",
        usedPercent: clampPercent((onDemandUsed / onDemandCap) * 100),
        resetAt: parseDate(config.billingPeriodEnd ?? config.billing_period_end),
        detail: `${formatCurrencyCents(onDemandUsed)} / ${formatCurrencyCents(onDemandCap)}`,
      })
    }
  }
  return [...windows.values()]
}

function addXaiWindow(windows, window) {
  const current = windows.get(window.label)
  windows.set(
    window.label,
    current
      ? {
          ...current,
          detail: current.detail ?? window.detail,
          resetAt: current.resetAt ?? window.resetAt,
        }
      : window,
  )
}

function findClaudeFableLimit(payload) {
  if (!Array.isArray(payload?.limits)) return null
  const candidates = payload.limits.filter(limit => {
    const kind = String(limit?.kind ?? "").toLowerCase()
    const model = String(limit?.scope?.model?.display_name ?? "").toLowerCase()
    return (
      kind === "weekly_scoped" &&
      ["fable", "fable 5"].includes(model) &&
      numberValue(limit?.percent) !== null
    )
  })
  return candidates.find(limit => limit.is_active === true) ?? candidates[0] ?? null
}

function resolveClaudePlan(profile) {
  const account = objectValue(profile?.account)
  if (booleanValue(account.has_claude_max)) return "Max"
  if (booleanValue(account.has_claude_pro)) return "Pro"
  const organization = objectValue(profile?.organization)
  if (
    String(organization.organization_type).toLowerCase() === "claude_team" &&
    String(organization.subscription_status).toLowerCase() === "active"
  ) {
    return "Team"
  }
  if (account.has_claude_max !== undefined && account.has_claude_pro !== undefined) return "Free"
  return null
}

function resolveProjectId(file) {
  const metadata = objectValue(file?.metadata)
  const attributes = objectValue(file?.attributes)
  return firstString(
    file?.project_id,
    file?.projectId,
    metadata.project_id,
    metadata.projectId,
    attributes.project_id,
    attributes.projectId,
    attributes.gemini_virtual_project,
  )
}

function buildXaiHeaders(file) {
  const headers = { ...API_HEADERS.xai }
  const metadata = objectValue(file?.metadata)
  const attributes = objectValue(file?.attributes)
  const userId = firstString(
    file?.sub,
    file?.subject,
    file?.user_id,
    file?.userId,
    metadata.sub,
    metadata.subject,
    metadata.user_id,
    metadata.userId,
    attributes.sub,
    attributes.subject,
    attributes.user_id,
    attributes.userId,
  )
  if (userId) headers["x-userid"] = userId
  return headers
}

function selectCpaQuotaFiles(files, accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return files
  const selected = new Set()
  const accountIds = new Set()
  for (const value of accounts) {
    if (value && typeof value === "object") {
      if (value.source === "cpa") {
        selected.add(quotaAccountKey("cpa", value.platform, value.accountId))
      }
      continue
    }
    const parsed = parseQuotaAccountReference(value)
    if (parsed?.source === "cpa") {
      selected.add(quotaAccountKey(parsed.source, parsed.platform, parsed.accountId))
    } else if (String(value).trim()) {
      accountIds.add(String(value).trim())
    }
  }
  return files.filter(file => {
    const provider = normalizeCpaProvider(file?.provider ?? file?.type)
    const index = authIndex(file)
    return selected.has(quotaAccountKey("cpa", provider, index)) || accountIds.has(index)
  })
}

async function apiCallPayload(config, file, request, fetchImpl, providerLabel) {
  const payload = {
    auth_index: authIndex(file),
    method: request.method,
    url: request.url,
    header: request.header,
  }
  if (request.data !== undefined) payload.data = request.data
  const result = await cpaRequest(
    config,
    "/v0/management/api-call",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl,
  )
  return parseApiCallResult(result, providerLabel)
}

async function fetchCpaAuthFiles(config, fetchImpl) {
  assertServiceConfig("CPA", config, "managementKey")
  const payload = await cpaRequest(config, "/v0/management/auth-files", {}, fetchImpl)
  return Array.isArray(payload?.files) ? payload.files : []
}

async function cpaRequest(config, path, options = {}, fetchImpl) {
  return requestJson(
    new URL(path.replace(/^\/+/, ""), `${config.baseUrl.replace(/\/+$/, "")}/`),
    {
      ...options,
      headers: {
        Authorization: `Bearer ${config.managementKey}`,
        ...options.headers,
      },
    },
    config.timeoutMs,
    fetchImpl,
  )
}

function rateLimitWindows(limit) {
  return [
    limit?.primary_window ?? limit?.primaryWindow,
    limit?.secondary_window ?? limit?.secondaryWindow,
  ].filter(window => window && typeof window === "object")
}

function quotaResetDate(window) {
  const direct = window?.reset_at ?? window?.resetAt
  if (direct !== undefined && direct !== null && direct !== "") {
    const numeric = numberValue(direct)
    return validDate(
      numeric === null ? new Date(direct) : new Date(numeric < 1e12 ? numeric * 1000 : numeric),
    )
  }
  const after = numberValue(window?.reset_after_seconds ?? window?.resetAfterSeconds)
  return after === null ? null : validDate(new Date(Date.now() + after * 1000))
}

function kimiResetDate(data) {
  const direct = data.reset_at ?? data.resetAt ?? data.reset_time ?? data.resetTime
  const parsed = parseDate(direct)
  if (parsed) return parsed
  const after = numberValue(data.reset_in ?? data.resetIn ?? data.ttl)
  return after === null ? null : validDate(new Date(Date.now() + after * 1000))
}

function kimiWindowLabel(durationValue, unitValue) {
  const duration = numberValue(durationValue)
  if (duration === null || duration <= 0) return ""
  const unit = String(unitValue ?? "TIME_UNIT_MINUTE")
    .toUpperCase()
    .replace(/^TIME_UNIT_/, "")
  if (["SECOND", "SECONDS"].includes(unit)) return `${duration} 秒`
  if (["HOUR", "HOURS"].includes(unit)) return `${duration} 小时`
  if (["DAY", "DAYS"].includes(unit)) return `${duration} 天`
  if (["WEEK", "WEEKS"].includes(unit)) return `${duration} 周`
  return duration % 60 === 0 ? `${duration / 60} 小时` : `${duration} 分钟`
}

function windowLabel(seconds) {
  if (seconds === 18000) return "5 小时"
  if (seconds === 604800) return "每周"
  if (seconds !== null && seconds >= 28 * 86400 && seconds <= 31 * 86400) return "每月"
  if (seconds !== null) return `${Math.round((seconds / 3600) * 10) / 10} 小时`
  return "额度"
}

function resolveCodexAccountId(file) {
  const candidates = [file?.id_token, file?.metadata?.id_token, file?.attributes?.id_token]
  for (const candidate of candidates) {
    const payload = decodeJwtPayload(candidate)
    const id = payload?.chatgpt_account_id ?? payload?.chatgptAccountId
    if (id) return String(id)
  }
  return ""
}

function resolveCodexPlan(file) {
  const claims = decodeJwtPayload(file?.id_token)
  return firstString(file?.plan_type, file?.planType, claims?.plan_type, claims?.planType) || null
}

function decodeJwtPayload(value) {
  if (value && typeof value === "object") {
    return value["https://api.openai.com/auth"] ?? value
  }
  if (typeof value !== "string") return null
  const parts = value.split(".")
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    return payload?.["https://api.openai.com/auth"] ?? payload
  } catch {
    return null
  }
}

function parseNestedPayload(value) {
  const payload = parseObject(value)
  if (!payload) return null
  if (Array.isArray(payload.groups)) return payload
  return parseObject(payload.body) ?? payload
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function quotaFraction(value) {
  if (typeof value === "string" && value.trim().endsWith("%")) {
    const percent = Number(value.trim().slice(0, -1))
    return Number.isFinite(percent) ? clampFraction(percent / 100) : null
  }
  const number = numberValue(value)
  if (number === null) return null
  return clampFraction(number > 1 ? number / 100 : number)
}

function centValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return numberValue(value.val)
  return numberValue(value)
}

function apiCallErrorReason(result) {
  const body = parseObject(result?.body ?? result?.bodyText)
  return String(body?.details?.find?.(item => item?.debug?.reason)?.debug?.reason ?? "")
}

function apiCallErrorMessage(result) {
  const body = parseObject(result?.body ?? result?.bodyText)
  const message = body?.error?.message ?? body?.error ?? body?.message
  return typeof message === "string" ? singleLine(message) : ""
}

function authIndex(file) {
  return String(file?.auth_index ?? file?.authIndex ?? "").trim()
}

function accountName(file) {
  return (
    firstString(file?.note, file?.label, file?.email, file?.account, file?.name, authIndex(file)) ||
    "未知账号"
  )
}

function isDisabled(file) {
  const value = file?.disabled
  if (typeof value === "string") return value.trim().toLowerCase() === "true"
  return Boolean(value)
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function firstString(...values) {
  for (const value of values) {
    const text = singleLine(value).trim()
    if (text) return text
  }
  return ""
}

function booleanValue(value) {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  return ["true", "1", "yes", "y", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  )
}

function parseDate(value) {
  if (value === undefined || value === null || value === "") return null
  const numeric = numberValue(value)
  return validDate(
    numeric === null ? new Date(value) : new Date(numeric < 1e12 ? numeric * 1000 : numeric),
  )
}

function validDate(date) {
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function clampFraction(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function formatCurrencyCents(value) {
  return `$${(Number(value) / 100).toFixed(2)}`
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "")
}

function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ")
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
