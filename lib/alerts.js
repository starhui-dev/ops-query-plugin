import { getS2aQuotaRemainingPercentages } from "./s2a-quota.js"
import { QUOTA_PLATFORM_KEYS } from "./quota-platforms.js"
import { maskAccount } from "./privacy.js"

export function parseAlertAccount(rule) {
  if (rule?.platform && (rule?.accountId || rule?.account_id)) {
    return normalizeAlertAccount(rule.platform, rule.accountId ?? rule.account_id)
  }
  const value = String(rule?.account ?? "")
  const separator = value.indexOf(":")
  if (separator <= 0 || separator === value.length - 1) return null
  return normalizeAlertAccount(value.slice(0, separator), value.slice(separator + 1))
}

export function evaluateQuotaAlerts(rules, results, states = new Map()) {
  const alerts = []
  const resultMap = new Map(
    results.map(result => [accountKey(result.platform, result.account?.id), result]),
  )

  for (const rule of rules) {
    const account = parseAlertAccount(rule)
    if (!account) continue
    const key = accountKey(account.platform, account.accountId)
    const result = resultMap.get(key)
    if (!result || result.error) continue
    const percentages = getS2aQuotaRemainingPercentages(result)
    if (!percentages.length) continue

    const remainingPercent = Math.min(...percentages)
    const thresholdPercent = Number(rule.thresholdPercent)
    const low = remainingPercent < thresholdPercent
    if (!low) {
      states.delete(key)
      continue
    }
    if (states.get(key) === "low") continue
    states.set(key, "low")
    alerts.push({ account, result, remainingPercent, thresholdPercent })
  }
  return alerts
}

export function formatQuotaAlerts(alerts) {
  return [
    "S2A 账号额度告警",
    `${alerts.length} 个账号低于告警阈值`,
    ...alerts.map(alert => {
      const name = maskedAccountName(alert.result)
      return [
        `${alert.result.label} · ${name}`,
        `当前最低  ${formatPercent(alert.remainingPercent)}`,
        `告警阈值  ${formatPercent(alert.thresholdPercent)}`,
      ].join("\n")
    }),
  ].join("\n\n")
}

export function buildQuotaAlertImageData(alerts, timeZone = "Asia/Shanghai", now = Date.now()) {
  return {
    theme: "alert",
    kicker: "S2A / QUOTA ALERT",
    title: "额度告警",
    subtitle: "S2A 账号剩余额度已低于阈值",
    updatedAt: formatImageTime(now, timeZone),
    summary: [
      { label: "触发账号", value: String(alerts.length), tone: "danger" },
      { label: "需要处理", value: String(alerts.length), tone: "warning" },
    ],
    sections: alerts.map(alert => ({
      title: maskedAccountName(alert.result),
      kind: alert.result.label,
      subtitle: accountTypeLabel(alert.result.account),
      badge: "额度偏低",
      badgeTone: "danger",
      rows: [
        {
          label: "当前最低剩余",
          value: formatPercent(alert.remainingPercent),
          progress: clampPercent(alert.remainingPercent),
          tone: "danger",
        },
        {
          label: "告警阈值",
          value: formatPercent(alert.thresholdPercent),
          detail: "额度恢复至阈值以上后，才会再次触发告警",
          tone: "warning",
        },
      ],
    })),
  }
}

export function buildMentionSegments(alerts) {
  if (alerts.mentionMode === "all") return [segment.at("all"), "\n"]
  if (alerts.mentionMode !== "users") return []
  return alerts.mentionUsers.flatMap(userId => [segment.at(userId), " "])
}

function normalizeAlertAccount(platformValue, accountIdValue) {
  const platform = String(platformValue).toLowerCase()
  const accountId = Number(accountIdValue)
  if (
    !QUOTA_PLATFORM_KEYS.includes(platform) ||
    !Number.isSafeInteger(accountId) ||
    accountId <= 0
  ) {
    return null
  }
  return { platform, accountId }
}

function accountKey(platform, accountId) {
  return `${String(platform).toLowerCase()}:${String(accountId ?? "")}`
}

function accountTypeLabel(account) {
  return String(account?.type ?? "").toLowerCase() === "oauth" ? "S2A OAuth 账号" : "S2A Key 账号"
}

function maskedAccountName(result) {
  const name = String(result?.account?.name ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
  if (!name) return "未命名账号"
  return name.includes("@") ? maskAccount(name) : name
}

function formatPercent(value) {
  const number = Number(value)
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
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
