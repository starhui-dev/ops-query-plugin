import { maskAccount } from "./privacy.js"

// CPA 与 NewAPI 的额度结果统一为
// { source, platform, label, account, plan, timeZone, windows, error }，
// 这里只负责展示，不关心数据来自哪个后端。
const SOURCE_LABELS = { cpa: "CPA", newapi: "NewAPI" }

export function quotaSourceLabel(source) {
  const key = String(source ?? "").toLowerCase()
  return SOURCE_LABELS[key] ?? key.toUpperCase()
}

export function formatAccountQuotaResult(result) {
  const title = [
    quotaSourceLabel(result.source ?? result.account?.source),
    result.label,
    maskedAccountName(result),
  ]
    .filter(Boolean)
    .join(" · ")
  if (result.error) return `${title}\n查询失败  ${singleLine(result.error)}`

  const meta = result.plan ? `\n套餐：${singleLine(result.plan)}` : ""
  const rows = result.windows.map(window =>
    [
      `${window.label}  ${formatWindowValue(window)}${formatWindowDetail(window)}`,
      formatReset(window, result.timeZone),
    ]
      .filter(Boolean)
      .join("  "),
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
    .filter(window => window.usedPercent !== null && window.usedPercent !== undefined)
    .map(window => clampPercent(100 - window.usedPercent))
}

export function accountDisplayName(value, fallback = "未命名账号") {
  const name = singleLine(value).trim()
  if (!name) return fallback
  return name.includes("@") ? maskAccount(name) : name
}

function accountTypeLabel(account) {
  const source = quotaSourceLabel(account?.source)
  const rawType = String(account?.type ?? "").toLowerCase()
  const type = rawType === "oauth" ? "OAuth" : rawType === "apikey" ? "Key" : rawType || "账号"
  return [source, type, "账号"].filter(Boolean).join(" ")
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
    const remaining =
      window.usedPercent === null || window.usedPercent === undefined
        ? null
        : clampPercent(100 - window.usedPercent)
    return {
      label: window.label,
      value: formatWindowValue(window),
      detail: [singleLine(window.detail).trim(), formatReset(window, timeZone)]
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

function maskedAccountName(result) {
  return accountDisplayName(result?.account?.name)
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
    return currency ? `${currency} ${formatAmount(window.balance)}` : formatAmount(window.balance)
  }
  return "未知"
}

function formatWindowDetail(window) {
  const detail = singleLine(window?.detail).trim()
  return detail ? `  ${detail}` : ""
}

// 窗口可用 resetNote 说明没有重置时间的原因（例如滚动窗口尚未开始计时）。
// 余额没有重置周期，不显示“重置时间未知”。
function formatReset(window, timeZone) {
  const date = window?.resetAt
  if (!date) {
    const note = singleLine(window?.resetNote).trim()
    if (note) return note
    return isBalanceWindow(window) ? "" : "重置时间未知"
  }
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

function isBalanceWindow(window) {
  return (
    (window?.usedPercent === null || window?.usedPercent === undefined) &&
    window?.balance !== null &&
    window?.balance !== undefined
  )
}

// 金额保留两位小数（去掉末尾多余的 0），百分比等仍用 formatNumber 的一位小数。
function formatAmount(value) {
  return String(Number(Number(value).toFixed(2)))
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "")
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ")
}
