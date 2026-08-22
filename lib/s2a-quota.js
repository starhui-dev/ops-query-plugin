import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"
import { maskAccount } from "./privacy.js"
import { formatQuotaAccountReference } from "./quota-account.js"
import { quotaPlatform } from "./quota-platforms.js"

const PAGE_SIZE = 100

// 各平台把额度窗口写在账号快照的不同字段里，这里统一成 { label, usedPercent, resetAt }。
const WINDOW_EXTRACTORS = {
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
    label: `S2A · ${quotaPlatform(account).label} · ${accountDisplayName(account.name, "未命名账号")}`,
    value: formatQuotaAccountReference({
      source: "s2a",
      platform: accountPlatform(account),
      accountId: account.id,
    }),
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
    const result = buildQuotaResult(account, timeZone)
    if (result.error || result.windows.length) results.push(result)
  }

  return results
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
      `${window.label}  剩余 ${formatRemaining(window)}${formatWindowDetail(window)}  ${formatReset(window.resetAt, result.timeZone)}`,
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
  return String(account?.platform ?? "").toLowerCase()
}

function buildQuotaResult(account, timeZone) {
  const platform = accountPlatform(account)
  return {
    source: "s2a",
    platform,
    label: quotaPlatform(account).label,
    account: { ...account, source: "s2a" },
    plan: null,
    timeZone,
    windows: WINDOW_EXTRACTORS[platform](account),
  }
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
      detail: [singleLine(window.detail).trim(), formatReset(window.resetAt, timeZone)]
        .filter(Boolean)
        .join("｜"),
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
  const source = String(account?.source ?? "").toUpperCase()
  const type = String(account?.type ?? "").toLowerCase() === "oauth" ? "OAuth" : "Key"
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
  if (window.usedPercent === null) return "未知"
  return `${formatNumber(clampPercent(100 - window.usedPercent))}%`
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
  return validDate(new Date(value))
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
