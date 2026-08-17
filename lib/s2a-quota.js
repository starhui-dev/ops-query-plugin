import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"
import { maskAccount } from "./privacy.js"

const PAGE_SIZE = 100

export async function listS2aOAuthAccounts(config, fetchImpl) {
  assertServiceConfig("S2A", config, "adminApiKey")
  const accounts = []
  let page = 1
  let pages = 1

  do {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      platform: "openai",
      type: "oauth",
      lite: "true",
    })
    const data = readResponseData(
      await s2aRequest(config, `/api/v1/admin/accounts?${query}`, {}, fetchImpl),
    )
    if (Array.isArray(data.items)) accounts.push(...data.items)
    pages = Math.max(1, Number(data.pages) || 1)
    page += 1
  } while (page <= pages)

  return accounts.filter(isOpenAiOAuthAccount)
}

export async function listS2aQuotaAccountOptions(config, fetchImpl) {
  return buildS2aQuotaAccountOptions(await listS2aOAuthAccounts(config, fetchImpl))
}

export function buildS2aQuotaAccountOptions(accounts) {
  return accounts.filter(isOpenAiOAuthAccount).map(account => ({
    label: accountDisplayName(account.name, "未命名 Codex 账号"),
    value: `openai:${account.id}`,
  }))
}

export async function queryS2aQuota(
  config,
  timeZone = "Asia/Shanghai",
  accountIds = [],
  fetchImpl,
) {
  const accounts = selectAccounts(await listS2aOAuthAccounts(config, fetchImpl), accountIds)
  const results = []

  for (const account of accounts) {
    try {
      const quota = readResponseData(
        await s2aRequest(
          config,
          `/api/v1/admin/openai/accounts/${account.id}/quota`,
          {},
          fetchImpl,
        ),
      )
      results.push({ provider: "openai", account, quota, timeZone })
    } catch (error) {
      results.push({
        provider: "openai",
        account,
        error: errorMessage(error),
        timeZone,
      })
    }
  }

  return results
}

export async function queryS2aQuotaUsage(config, accountIds = [], fetchImpl) {
  const accounts = selectAccounts(await listS2aOAuthAccounts(config, fetchImpl), accountIds)
  if (!accounts.length) return []

  const payload = await s2aRequest(
    config,
    "/api/v1/admin/accounts/usage/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_ids: accounts.map(account => account.id), force: false }),
    },
    fetchImpl,
  )
  const data = readResponseData(payload)
  const usage = objectValue(data.usage)
  const errors = objectValue(data.errors)

  return accounts.map(account => {
    const key = String(account.id)
    if (errors[key]) {
      return { provider: "openai", account, error: singleLine(errors[key]) }
    }
    if (!usage[key] || typeof usage[key] !== "object") {
      return { provider: "openai", account, error: "S2A 未返回账号用量" }
    }
    return { provider: "openai", account, usage: usage[key] }
  })
}

export function formatS2aQuotaResult(result) {
  const title = `Codex · ${maskedAccountName(result)}`
  if (result.error) return `${title}\n查询失败  ${singleLine(result.error)}`

  const plan = result.quota?.plan_type
  const meta = plan ? `\n套餐：${singleLine(plan)}` : ""
  const rows = formatQuotaRows(result.quota, result.timeZone)
  return `${title}${meta}\n${rows.length ? rows.join("\n") : "未返回可识别的额度窗口"}`
}

export function formatS2aQuota(results) {
  return [
    "S2A Codex 额度",
    `共 ${results.length} 个账号`,
    ...results.map(formatS2aQuotaResult),
  ].join("\n\n")
}

export function buildS2aQuotaImageData(results, timeZone = "Asia/Shanghai", now = Date.now()) {
  const successful = results.filter(result => !result.error)
  const percentages = successful.flatMap(getS2aQuotaRemainingPercentages)
  const lowest = percentages.length ? Math.min(...percentages) : null

  return {
    theme: "codex",
    kicker: "S2A / CODEX",
    title: "Codex 订阅",
    subtitle: "OAuth 账号额度与重置窗口",
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
  if (result?.error || !result?.quota) return []
  return quotaGroups(result.quota).flatMap(([, limit]) => remainingPercentages(limit))
}

export function getS2aUsageRemainingPercentages(result) {
  if (result?.error || !result?.usage) return []
  const percentages = []
  for (const window of [result.usage.five_hour, result.usage.seven_day]) {
    const used = numberValue(window?.utilization)
    if (used !== null) percentages.push(clampPercent(100 - used))
  }
  return percentages
}

function formatQuotaRows(quota, timeZone) {
  const rows = []
  for (const [label, limit] of quotaGroups(quota)) {
    for (const window of rateLimitWindows(limit)) {
      const used = numberValue(window.used_percent)
      const remaining = used === null ? "未知" : `${formatNumber(clampPercent(100 - used))}%`
      rows.push(
        `${label} ${windowLabel(window)}  剩余 ${remaining}  ${formatReset(window, timeZone)}`,
      )
    }
  }
  return rows
}

function buildQuotaImageSection(result, timeZone) {
  const title = maskedAccountName(result)
  if (result.error) {
    return {
      title,
      subtitle: "S2A OAuth 账号",
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

  const rows = []
  for (const [label, limit] of quotaGroups(result.quota)) {
    for (const window of rateLimitWindows(limit)) {
      const used = numberValue(window.used_percent)
      const remaining = used === null ? null : clampPercent(100 - used)
      rows.push({
        label: `${singleLine(label)} · ${windowLabel(window)}`,
        value: remaining === null ? "未知" : `${formatNumber(remaining)}%`,
        detail: formatReset(window, timeZone),
        progress: remaining,
        tone: remaining === null ? "muted" : percentTone(remaining),
      })
    }
  }

  const plan = result.quota?.plan_type
  return {
    title,
    subtitle: "S2A OAuth 账号",
    badge: plan ? singleLine(plan).toUpperCase() : "可用",
    badgeTone: "success",
    rows: rows.length
      ? rows
      : [{ label: "额度窗口", value: "暂不可用", tone: "muted", wide: true }],
  }
}

function quotaGroups(quota) {
  const groups = [["Codex", quota?.rate_limit]]
  if (Array.isArray(quota?.additional_rate_limits)) {
    for (const item of quota.additional_rate_limits) {
      groups.push([
        String(item?.limit_name || item?.metered_feature || "附加额度"),
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

function remainingPercentages(limit) {
  const percentages = []
  for (const window of rateLimitWindows(limit)) {
    const used = numberValue(window.used_percent)
    if (used !== null) percentages.push(clampPercent(100 - used))
  }
  return percentages
}

function selectAccounts(accounts, accountIds) {
  const selected = new Set(accountIds.map(String).filter(Boolean))
  return selected.size ? accounts.filter(account => selected.has(String(account.id))) : accounts
}

function isOpenAiOAuthAccount(account) {
  const id = Number(account?.id)
  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    String(account?.platform).toLowerCase() === "openai" &&
    String(account?.type).toLowerCase() === "oauth"
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

function maskedAccountName(result) {
  return accountDisplayName(result?.account?.name || result?.quota?.email, "未命名 Codex 账号")
}

function accountDisplayName(value, fallback) {
  const name = singleLine(value).trim()
  if (!name) return fallback
  return name.includes("@") ? maskAccount(name) : name
}

function windowLabel(window) {
  const seconds = numberValue(window.limit_window_seconds)
  if (seconds === 18000) return "5 小时"
  if (seconds === 604800) return "每周"
  if (seconds !== null && seconds >= 28 * 86400 && seconds <= 31 * 86400) return "每月"
  if (seconds !== null) return `${Math.round((seconds / 3600) * 10) / 10} 小时`
  return "额度"
}

function formatReset(window, timeZone) {
  const direct = window.reset_at
  const after = numberValue(window.reset_after_seconds)
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
