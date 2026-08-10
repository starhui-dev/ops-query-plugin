import { assertServiceConfig } from "./config.js"
import { HttpError, requestJson } from "./http.js"

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const CODEX_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
}

export async function queryCpaQuota(config, timeZone = "Asia/Shanghai", authIndexes = []) {
  assertServiceConfig("CPA", config, "managementKey")
  const headers = {
    Authorization: `Bearer ${config.managementKey}`,
  }
  const list = await requestJson(
    `${config.baseUrl}/v0/management/auth-files`,
    { headers },
    config.timeoutMs,
  )
  const files = getProviderAuthFiles(list, "codex", authIndexes)

  const results = []
  for (const file of files) {
    try {
      const apiHeaders = { ...CODEX_HEADERS }
      const accountId = resolveAccountId(file)
      if (accountId) apiHeaders["Chatgpt-Account-Id"] = accountId

      const result = await requestJson(
        `${config.baseUrl}/v0/management/api-call`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            auth_index: file.auth_index ?? file.authIndex,
            method: "GET",
            url: CODEX_USAGE_URL,
            header: apiHeaders,
          }),
        },
        config.timeoutMs,
      )
      const payload = parseApiCallResult(result)
      results.push({
        provider: "codex",
        file,
        quota: payload,
        timeZone,
      })
    } catch (error) {
      results.push({ provider: "codex", file, error: errorMessage(error), timeZone })
    }
  }
  return results
}

export async function queryCpaStatus(config) {
  assertServiceConfig("CPA", config, "managementKey")
  const request = path =>
    requestJson(
      `${config.baseUrl}/v0/management/${path}`,
      { headers: { Authorization: `Bearer ${config.managementKey}` } },
      config.timeoutMs,
    )
  const [authPayload, keyPayload, usagePayload] = await Promise.all([
    request("auth-files"),
    request("codex-api-key"),
    request("api-key-usage"),
  ])
  return {
    files: getAuthFiles(authPayload),
    codexKeys: getCodexApiKeys(keyPayload),
    apiKeyUsage: getCodexApiKeyUsage(usagePayload),
  }
}

export async function listCpaQuotaAccounts(config) {
  assertServiceConfig("CPA", config, "managementKey")
  const files = getAuthFiles(
    await requestJson(
      `${config.baseUrl}/v0/management/auth-files`,
      { headers: { Authorization: `Bearer ${config.managementKey}` } },
      config.timeoutMs,
    ),
  )
  return files
    .filter(file => {
      const provider = normalizeProvider(file?.provider ?? file?.type)
      return provider === "codex" && !file.disabled
    })
    .map(file => {
      const authIndex = String(file?.auth_index ?? file?.authIndex ?? "")
      return {
        label: `[Codex] ${accountName(file)} (${authIndex})`,
        value: `codex:${authIndex}`,
      }
    })
    .filter(account => !account.value.endsWith(":"))
}

export function getAuthFiles(payload) {
  return Array.isArray(payload?.files) ? payload.files : []
}

export function getCodexApiKeys(payload) {
  return Array.isArray(payload?.["codex-api-key"]) ? payload["codex-api-key"] : []
}

function getCodexApiKeyUsage(payload) {
  const usage = payload?.codex
  return usage && typeof usage === "object" && !Array.isArray(usage) ? usage : {}
}

export function getCodexAuthFiles(payload) {
  return getProviderAuthFiles(payload, "codex")
}

export function getProviderAuthFiles(payload, provider, authIndexes = []) {
  const normalizedProvider = normalizeProvider(provider)
  const selected = new Set(authIndexes.map(String).filter(Boolean))
  return getAuthFiles(payload).filter(file => {
    const fileProvider = normalizeProvider(file?.provider ?? file?.type)
    const authIndex = String(file?.auth_index ?? file?.authIndex ?? "")
    return (
      fileProvider === normalizedProvider &&
      !file.disabled &&
      (!selected.size || selected.has(authIndex))
    )
  })
}

export function formatCpaStatus(report) {
  const { files, codexKeys, apiKeyUsage } = normalizeCpaStatusReport(report)
  const lines = ["CPA 状态", `凭据 ${files.length} 个｜API 渠道 ${codexKeys.length} 个`]

  for (const file of files) {
    const activity = summarizeRecentRequests(file?.recent_requests)
    lines.push(
      [
        `${providerDisplayName(normalizeProvider(file?.provider ?? file?.type))} · ${singleLine(accountName(file))} · ${credentialStatusLabel(file)}`,
        `成功 ${integerValue(file?.success)}｜失败 ${integerValue(file?.failed)}｜近 3 小时健康 ${healthText(activity.healthPercent)}`,
        `文件 ${formatBytes(file?.size)}｜更新 ${formatStatusTime(file?.modtime ?? file?.updated_at)}`,
        `优先级 ${integerValue(file?.priority, 0)}｜WRR 权重 ${integerValue(file?.weight, 1)}`,
      ].join("\n"),
    )
  }

  for (const key of codexKeys) {
    const usage = findApiKeyUsage(apiKeyUsage, key)
    const activity = summarizeRecentRequests(usage?.recent_requests)
    lines.push(
      [
        `Codex API · ${maskSecret(key?.["api-key"])} · ${key?.disabled ? "停用" : "启用"}`,
        `地址 ${safeDisplayUrl(key?.["base-url"]) || "默认地址"}`,
        `模型 ${arrayLength(key?.models)}｜请求头 ${objectSize(key?.headers)}｜前缀 ${singleLine(key?.prefix || "无")}`,
        `成功 ${integerValue(usage?.success)}｜失败 ${integerValue(usage?.failed)}｜近 3 小时健康 ${healthText(activity.healthPercent)}`,
      ].join("\n"),
    )
  }
  return [lines.slice(0, 2).join("\n"), ...lines.slice(2)].join("\n\n")
}

export function buildCpaStatusImageData(report, timeZone = "Asia/Shanghai", now = Date.now()) {
  const { files, codexKeys, apiKeyUsage } = normalizeCpaStatusReport(report)
  const available = files.filter(file => credentialState(file) === "available").length
  const overallActivity = summarizeRecentRequests([
    ...files.flatMap(file => normalizeRecentRequests(file?.recent_requests)),
    ...Object.values(apiKeyUsage).flatMap(usage => normalizeRecentRequests(usage?.recent_requests)),
  ])

  return {
    theme: "cpa",
    kicker: "CPA / RUNTIME STATUS",
    title: "CPA 状态",
    subtitle: "凭据与 Codex API 渠道运行概览",
    updatedAt: formatImageTime(now, timeZone),
    summary: [
      { label: "凭据", value: String(files.length), tone: "info" },
      { label: "可用", value: String(available), tone: "success" },
      { label: "API 渠道", value: String(codexKeys.length), tone: "info" },
      {
        label: "近 3 小时健康",
        value: healthText(overallActivity.healthPercent),
        tone: healthTone(overallActivity.healthPercent),
      },
    ],
    sections: [
      ...files.map(file => buildCredentialStatusSection(file, timeZone)),
      ...codexKeys.map(key => buildApiKeyStatusSection(key, apiKeyUsage)),
    ],
  }
}

export function summarizeRecentRequests(value) {
  const buckets = normalizeRecentRequests(value)
  let success = 0
  let failed = 0
  const segments = buckets.map(bucket => {
    const bucketSuccess = integerValue(bucket?.success)
    const bucketFailed = integerValue(bucket?.failed)
    success += bucketSuccess
    failed += bucketFailed
    const total = bucketSuccess + bucketFailed
    let tone = "idle"
    if (total > 0) {
      const percentage = (bucketSuccess / total) * 100
      tone = bucketFailed === 0 ? "success" : percentage >= 80 ? "warning" : "danger"
    }
    return { tone, label: singleLine(bucket?.time || "") }
  })
  const total = success + failed
  return {
    success,
    failed,
    healthPercent: total ? Math.round((success / total) * 1000) / 10 : null,
    segments,
  }
}

function normalizeCpaStatusReport(report) {
  if (Array.isArray(report)) {
    return { files: report, codexKeys: [], apiKeyUsage: {} }
  }
  return {
    files: Array.isArray(report?.files) ? report.files : [],
    codexKeys: Array.isArray(report?.codexKeys) ? report.codexKeys : [],
    apiKeyUsage:
      report?.apiKeyUsage && typeof report.apiKeyUsage === "object" ? report.apiKeyUsage : {},
  }
}

function buildCredentialStatusSection(file, timeZone) {
  const state = credentialState(file)
  const activity = summarizeRecentRequests(file?.recent_requests)
  const filename = singleLine(file?.name || file?.filename || "未提供文件名")
  return {
    kind: `${providerDisplayName(normalizeProvider(file?.provider ?? file?.type))} OAuth 凭据`,
    title: singleLine(accountName(file)),
    subtitle: filename,
    badge: credentialStatusLabel(file),
    badgeTone: state === "available" ? "success" : state === "disabled" ? "muted" : "danger",
    rows: [
      { label: "累计成功", value: String(integerValue(file?.success)), tone: "success" },
      { label: "累计失败", value: String(integerValue(file?.failed)), tone: "danger" },
      {
        label: "近 3 小时健康",
        value: healthText(activity.healthPercent),
        detail: `最近 ${activity.segments.length || 0} 个十分钟窗口`,
        progress: activity.healthPercent,
        segments: activity.segments,
        tone: healthTone(activity.healthPercent),
        wide: true,
      },
      { label: "文件", value: formatBytes(file?.size), detail: filename, tone: "info" },
      {
        label: "更新时间",
        value: formatStatusTime(file?.modtime ?? file?.updated_at, timeZone),
        tone: "muted",
      },
      { label: "优先级", value: String(integerValue(file?.priority, 0)), tone: "info" },
      { label: "WRR 权重", value: String(integerValue(file?.weight, 1)), tone: "info" },
    ],
  }
}

function buildApiKeyStatusSection(key, apiKeyUsage) {
  const usage = findApiKeyUsage(apiKeyUsage, key)
  const activity = summarizeRecentRequests(usage?.recent_requests)
  const disabled = Boolean(key?.disabled)
  return {
    kind: "Codex API 渠道",
    title: maskSecret(key?.["api-key"]),
    subtitle: safeDisplayUrl(key?.["base-url"]) || "默认服务地址",
    badge: disabled ? "停用" : "启用",
    badgeTone: disabled ? "muted" : "success",
    rows: [
      { label: "前缀", value: singleLine(key?.prefix || "无"), tone: "info" },
      { label: "模型", value: String(arrayLength(key?.models)), tone: "info" },
      { label: "请求头", value: String(objectSize(key?.headers)), tone: "info" },
      { label: "累计成功", value: String(integerValue(usage?.success)), tone: "success" },
      { label: "累计失败", value: String(integerValue(usage?.failed)), tone: "danger" },
      {
        label: "近 3 小时健康",
        value: healthText(activity.healthPercent),
        detail: `最近 ${activity.segments.length || 0} 个十分钟窗口`,
        progress: activity.healthPercent,
        segments: activity.segments,
        tone: healthTone(activity.healthPercent),
        wide: true,
      },
      { label: "优先级", value: String(integerValue(key?.priority, 0)), tone: "info" },
      { label: "WRR 权重", value: String(integerValue(key?.weight, 1)), tone: "info" },
    ],
  }
}

function normalizeRecentRequests(value) {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === "object")
  if (!value || typeof value !== "object") return []
  return Object.entries(value).map(([time, item]) =>
    item && typeof item === "object" ? { time, ...item } : { time },
  )
}

function credentialState(file) {
  const status = normalizeProvider(file?.status)
  if (file?.disabled || status === "disabled") return "disabled"
  if (file?.unavailable || ["error", "failed", "unavailable"].includes(status)) {
    return "unavailable"
  }
  return "available"
}

function credentialStatusLabel(file) {
  return { available: "正常", unavailable: "异常", disabled: "停用" }[credentialState(file)]
}

function healthText(value) {
  return value === null ? "--" : `${formatNumber(value)}%`
}

function healthTone(value) {
  if (value === null) return "muted"
  if (value >= 99) return "success"
  if (value >= 95) return "warning"
  return "danger"
}

function formatBytes(value) {
  const bytes = finiteNonNegativeNumber(value)
  if (bytes === null) return "未知"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${formatDecimal(bytes / 1024, 2)} KB`
  return `${formatDecimal(bytes / 1024 ** 2, 2)} MB`
}

function formatStatusTime(value, timeZone = "Asia/Shanghai") {
  if (!value) return "未知"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未知"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function integerValue(value, fallback = 0) {
  const number = numberValue(value)
  return number === null ? fallback : Math.trunc(number)
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0
}

function objectSize(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0
}

function findApiKeyUsage(apiKeyUsage, key) {
  const apiKey = String(key?.["api-key"] || "")
  const baseUrl = String(key?.["base-url"] || "")
  const direct = apiKeyUsage?.[`${baseUrl}|${apiKey}`]
  if (direct) return direct
  const normalizedUrl = baseUrl.replace(/\/+$/, "")
  for (const [composite, usage] of Object.entries(apiKeyUsage || {})) {
    const separator = composite.lastIndexOf("|")
    if (separator < 0) continue
    const usageUrl = composite.slice(0, separator).replace(/\/+$/, "")
    const usageKey = composite.slice(separator + 1)
    if (usageUrl === normalizedUrl && usageKey === apiKey) return usage
  }
  return {}
}

function maskSecret(value) {
  const secret = String(value || "")
  if (!secret) return "未配置密钥"
  if (secret.length <= 8) return `${secret.slice(0, 2)}******${secret.slice(-2)}`
  return `${secret.slice(0, 4)}******${secret.slice(-4)}`
}

function safeDisplayUrl(value) {
  const text = singleLine(value || "").trim()
  if (!text) return ""
  try {
    const url = new URL(text)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return text.replace(/[?#].*$/, "")
  }
}

function finiteNonNegativeNumber(value) {
  const number = numberValue(value)
  return number === null || number < 0 ? null : number
}

function formatDecimal(value, digits) {
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/, "")
}

export function parseApiCallResult(result) {
  const status = Number(result?.status_code ?? result?.statusCode ?? 0)
  if (status < 200 || status >= 300) {
    const reason = apiCallErrorReason(result)
    if (status === 401 && reason === "REASON_INVALID_AUTH_TOKEN") {
      throw new HttpError("Codex 凭据已失效（401），请重新登录账号", status)
    }
    const suffix = reason ? `（${reason}）` : ""
    throw new HttpError(`Codex 用量接口返回 HTTP ${status || "未知状态"}${suffix}`, status)
  }

  const body = result?.body ?? result?.bodyText
  if (body && typeof body === "object") return body
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("Codex 用量接口返回为空")
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error("Codex 用量接口返回的不是 JSON")
  }
}

export function formatCpaResult(result) {
  const name = accountName(result.file)
  if (result.error) return `${name}\n查询失败：${result.error}`

  const quota = result.quota
  const plan = String(quota.plan_type ?? quota.planType ?? "未知")
  const lines = [`${name}（${plan}）`]
  const groups = [
    ["Codex", quota.rate_limit ?? quota.rateLimit],
    ["代码审查", quota.code_review_rate_limit ?? quota.codeReviewRateLimit],
  ]

  for (const [label, rateLimit] of groups) {
    appendRateLimit(lines, label, rateLimit, result.timeZone)
  }
  const additional = quota.additional_rate_limits ?? quota.additionalRateLimits
  if (Array.isArray(additional)) {
    for (const item of additional) {
      const label = String(
        item?.limit_name ?? item?.limitName ?? item?.metered_feature ?? "附加额度",
      )
      appendRateLimit(lines, label, item?.rate_limit ?? item?.rateLimit, result.timeZone)
    }
  }
  if (lines.length === 1) lines.push("未返回可识别的额度窗口")
  return lines.join("\n")
}

export function formatCpaQuota(results) {
  return [
    "CPA Codex 额度",
    `共 ${results.length} 个账号`,
    ...results.map(formatCpaResultText),
  ].join("\n\n")
}

export function buildCpaQuotaImageData(results, timeZone = "Asia/Shanghai", now = Date.now()) {
  const successful = results.filter(result => !result.error)
  const percentages = successful.flatMap(getRemainingPercentages)
  const lowest = percentages.length ? Math.min(...percentages) : null

  return {
    theme: "codex",
    kicker: "CPA / CODEX",
    title: "Codex 订阅",
    subtitle: "账号额度与重置窗口",
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

export function getRemainingPercentages(result) {
  if (result?.error || !result?.quota) return []
  const percentages = []
  const limits = [
    result.quota.rate_limit ?? result.quota.rateLimit,
    result.quota.code_review_rate_limit ?? result.quota.codeReviewRateLimit,
  ]
  for (const limit of limits) {
    for (const window of [
      limit?.primary_window ?? limit?.primaryWindow,
      limit?.secondary_window ?? limit?.secondaryWindow,
    ]) {
      const used = numberValue(window?.used_percent ?? window?.usedPercent)
      if (used !== null) percentages.push(Math.max(0, 100 - used))
    }
  }
  return percentages
}

function appendRateLimit(lines, label, rateLimit, timeZone) {
  if (!rateLimit || typeof rateLimit !== "object") return
  const windows = [
    rateLimit.primary_window ?? rateLimit.primaryWindow,
    rateLimit.secondary_window ?? rateLimit.secondaryWindow,
  ].filter(Boolean)
  for (const window of windows) {
    const used = numberValue(window.used_percent ?? window.usedPercent)
    const remaining =
      used === null
        ? "未知"
        : `${Math.max(0, 100 - used)
            .toFixed(1)
            .replace(/\.0$/, "")}%`
    lines.push(
      `${label} ${windowLabel(window)}：剩余 ${remaining}，${formatReset(window, timeZone)}`,
    )
  }
}

function formatCpaResultText(result) {
  const name = singleLine(accountName(result.file))
  const title = `Codex · ${name}`
  if (result.error) return `${title}\n查询失败  ${singleLine(result.error)}`

  const rows = formatCodexRows(result.quota, result.timeZone)
  const plan = result.quota?.plan_type ?? result.quota?.planType
  const meta = plan ? `\n套餐：${singleLine(plan)}` : ""
  return `${title}${meta}\n${rows.length ? rows.join("\n") : "未返回可识别的额度窗口"}`
}

function formatCodexRows(quota, timeZone) {
  const rows = []
  const groups = [
    ["Codex", quota?.rate_limit ?? quota?.rateLimit],
    ["代码审查", quota?.code_review_rate_limit ?? quota?.codeReviewRateLimit],
  ]
  for (const [label, limit] of groups) {
    const windows = [
      limit?.primary_window ?? limit?.primaryWindow,
      limit?.secondary_window ?? limit?.secondaryWindow,
    ].filter(Boolean)
    for (const window of windows) {
      const used = numberValue(window.used_percent ?? window.usedPercent)
      const remaining = used === null ? "未知" : `${formatNumber(Math.max(0, 100 - used))}%`
      rows.push(
        `${label} ${windowLabel(window)}  剩余 ${remaining}  ${formatReset(window, timeZone)}`,
      )
    }
  }
  return rows
}

function buildQuotaImageSection(result, timeZone) {
  const title = singleLine(accountName(result.file))
  const authIndex = result.file?.auth_index ?? result.file?.authIndex
  if (result.error) {
    return {
      title,
      subtitle: authIndex ? `Codex · ${singleLine(authIndex)}` : "Codex 账号",
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

  const plan = result.quota?.plan_type ?? result.quota?.planType
  const rows = buildCodexImageRows(result.quota, timeZone)
  return {
    title,
    subtitle: authIndex ? `Codex · ${singleLine(authIndex)}` : "Codex 账号",
    badge: plan ? singleLine(plan).toUpperCase() : "可用",
    badgeTone: "success",
    rows: rows.length
      ? rows
      : [{ label: "额度窗口", value: "暂不可用", tone: "muted", wide: true }],
  }
}

function buildCodexImageRows(quota, timeZone) {
  const rows = []
  const groups = [
    ["Codex", quota?.rate_limit ?? quota?.rateLimit],
    ["代码审查", quota?.code_review_rate_limit ?? quota?.codeReviewRateLimit],
  ]
  const additional = quota?.additional_rate_limits ?? quota?.additionalRateLimits
  if (Array.isArray(additional)) {
    for (const item of additional) {
      groups.push([
        String(item?.limit_name ?? item?.limitName ?? item?.metered_feature ?? "附加额度"),
        item?.rate_limit ?? item?.rateLimit,
      ])
    }
  }

  for (const [label, limit] of groups) {
    const windows = [
      limit?.primary_window ?? limit?.primaryWindow,
      limit?.secondary_window ?? limit?.secondaryWindow,
    ].filter(Boolean)
    for (const window of windows) {
      const used = numberValue(window.used_percent ?? window.usedPercent)
      const remaining = used === null ? null : Math.max(0, Math.min(100, 100 - used))
      rows.push({
        label: `${singleLine(label)} · ${windowLabel(window)}`,
        value: remaining === null ? "未知" : `${formatNumber(remaining)}%`,
        detail: formatReset(window, timeZone),
        progress: remaining,
        tone: remaining === null ? "muted" : percentTone(remaining),
      })
    }
  }
  return rows
}

function apiCallErrorReason(result) {
  let body = result?.body ?? result?.bodyText
  if (typeof body === "string") {
    try {
      body = JSON.parse(body)
    } catch {
      return ""
    }
  }
  return String(body?.details?.find?.(item => item?.debug?.reason)?.debug?.reason ?? "")
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "")
}

function normalizeProvider(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

function summarizeCpaFiles(files) {
  const providers = new Map()
  for (const file of files) {
    const provider = normalizeProvider(file?.provider ?? file?.type) || "unknown"
    const counts = providers.get(provider) ?? { available: 0, unavailable: 0, disabled: 0 }
    const status = normalizeProvider(file?.status)
    if (file?.disabled || status === "disabled") counts.disabled += 1
    else if (file?.unavailable || ["error", "unavailable"].includes(status)) {
      counts.unavailable += 1
    } else counts.available += 1
    providers.set(provider, counts)
  }
  return providers
}

function providerDisplayName(provider) {
  const labels = {
    anthropic: "Anthropic",
    claude: "Claude",
    codex: "Codex",
    gemini: "Gemini",
    kimi: "Kimi",
    openai: "OpenAI",
    unknown: "未知提供商",
  }
  return labels[provider] ?? provider
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

function singleLine(value) {
  return String(value).replace(/[\r\n]+/g, " ")
}

function windowLabel(window) {
  const seconds = numberValue(window.limit_window_seconds ?? window.limitWindowSeconds)
  if (seconds === 18000) return "5 小时"
  if (seconds === 604800) return "每周"
  if (seconds !== null && seconds >= 28 * 86400 && seconds <= 31 * 86400) return "每月"
  if (seconds !== null) return `${Math.round((seconds / 3600) * 10) / 10} 小时`
  return "额度"
}

function formatReset(window, timeZone) {
  const direct = window.reset_at ?? window.resetAt
  const after = numberValue(window.reset_after_seconds ?? window.resetAfterSeconds)
  let date = null
  if (direct !== undefined && direct !== null) {
    const numeric = numberValue(direct)
    date = numeric === null ? new Date(direct) : new Date(numeric < 1e12 ? numeric * 1000 : numeric)
  } else if (after !== null) {
    date = new Date(Date.now() + after * 1000)
  }
  if (!date || Number.isNaN(date.getTime())) return "重置时间未知"
  return `重置于 ${new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)}`
}

function accountName(file) {
  return String(file?.email ?? file?.label ?? file?.name ?? file?.auth_index ?? "未知账号")
}

function resolveAccountId(file) {
  const candidates = [file?.id_token, file?.metadata?.id_token, file?.attributes?.id_token]
  for (const candidate of candidates) {
    const payload = decodeJwtPayload(candidate)
    const id = payload?.chatgpt_account_id ?? payload?.chatgptAccountId
    if (id) return String(id)
  }
  return ""
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

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
