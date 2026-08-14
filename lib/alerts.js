import { getS2aUsageRemainingPercentages } from "./s2a-quota.js"
import { maskAccount } from "./privacy.js"

export function parseAlertAccount(rule) {
  if (rule?.provider && (rule?.accountId || rule?.account_id)) {
    return normalizeAlertAccount(rule.provider, rule.accountId ?? rule.account_id)
  }
  const value = String(rule?.account ?? "")
  const separator = value.indexOf(":")
  if (separator <= 0 || separator === value.length - 1) return null
  return normalizeAlertAccount(value.slice(0, separator), value.slice(separator + 1))
}

export function evaluateQuotaAlerts(rules, results, states = new Map()) {
  const alerts = []
  const resultMap = new Map(
    results.map(result => [accountKey(result.provider, result.account?.id), result]),
  )

  for (const rule of rules) {
    const account = parseAlertAccount(rule)
    if (!account) continue
    const key = accountKey(account.provider, account.accountId)
    const result = resultMap.get(key)
    if (!result || result.error) continue
    const percentages = getS2aUsageRemainingPercentages(result)
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
    "S2A Codex 额度告警",
    `${alerts.length} 个账号低于告警阈值`,
    ...alerts.map(alert => {
      const name = maskedAccountName(alert.result)
      return [
        `Codex · ${name}`,
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
    subtitle: "Codex OAuth 账号剩余额度已低于阈值",
    updatedAt: formatImageTime(now, timeZone),
    summary: [
      { label: "触发账号", value: String(alerts.length), tone: "danger" },
      { label: "需要处理", value: String(alerts.length), tone: "warning" },
    ],
    sections: alerts.map(alert => ({
      title: maskedAccountName(alert.result),
      subtitle: "S2A OAuth 账号",
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

function normalizeAlertAccount(providerValue, accountIdValue) {
  const provider = String(providerValue).toLowerCase()
  const accountId = Number(accountIdValue)
  if (provider !== "openai" || !Number.isSafeInteger(accountId) || accountId <= 0) return null
  return { provider, accountId }
}

function accountKey(provider, accountId) {
  return `${String(provider).toLowerCase()}:${String(accountId ?? "")}`
}

function maskedAccountName(result) {
  const name = String(result?.account?.name ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
  if (!name) return "未命名 Codex 账号"
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
