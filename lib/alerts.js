import { getRemainingPercentages } from "./cpa.js"
import { maskAccount } from "./privacy.js"

export function parseAlertAccount(rule) {
  if (rule?.provider && (rule?.authIndex || rule?.auth_index)) {
    const provider = String(rule.provider).toLowerCase()
    if (provider !== "codex") return null
    return { provider, authIndex: String(rule.authIndex ?? rule.auth_index) }
  }
  const value = String(rule?.account ?? "")
  const separator = value.indexOf(":")
  if (separator <= 0 || separator === value.length - 1) return null
  const provider = value.slice(0, separator).toLowerCase()
  if (provider !== "codex") return null
  return { provider, authIndex: value.slice(separator + 1) }
}

export function evaluateQuotaAlerts(rules, results, states = new Map()) {
  const alerts = []
  const resultMap = new Map(
    results.map(result => [
      accountKey(result.provider, result.file?.auth_index ?? result.file?.authIndex),
      result,
    ]),
  )

  for (const rule of rules) {
    const account = parseAlertAccount(rule)
    if (!account) continue
    const key = accountKey(account.provider, account.authIndex)
    const result = resultMap.get(key)
    if (!result || result.error) continue
    const percentages = getRemainingPercentages(result)
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
    "CPA 额度告警",
    `${alerts.length} 个账号低于告警阈值`,
    ...alerts.map(alert => {
      const name = maskAccount(accountName(alert.result.file))
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
    kicker: "CPA / QUOTA ALERT",
    title: "额度告警",
    subtitle: "账号剩余额度已低于设定阈值",
    updatedAt: formatImageTime(now, timeZone),
    summary: [
      { label: "触发账号", value: String(alerts.length), tone: "danger" },
      { label: "需要处理", value: String(alerts.length), tone: "warning" },
    ],
    sections: alerts.map(alert => {
      return {
        title: maskAccount(accountName(alert.result.file)),
        subtitle: "Codex 账号",
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
      }
    }),
  }
}

export function buildMentionSegments(alerts) {
  if (alerts.mentionMode === "all") return [segment.at("all"), "\n"]
  if (alerts.mentionMode !== "users") return []
  return alerts.mentionUsers.flatMap(userId => [segment.at(userId), " "])
}

function accountKey(provider, authIndex) {
  return `${String(provider).toLowerCase()}:${String(authIndex ?? "")}`
}

function accountName(file) {
  return String(file?.email ?? file?.label ?? file?.name ?? file?.auth_index ?? "未知账号")
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

function singleLine(value) {
  return String(value).replace(/[\r\n]+/g, " ")
}
