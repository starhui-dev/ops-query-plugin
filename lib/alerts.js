import { getQuotaRemainingPercentages } from "./s2a-quota.js"
import { maskAccount } from "./privacy.js"
import {
  normalizeQuotaAccount,
  parseQuotaAccountReference,
  quotaAccountKey,
} from "./quota-account.js"

export function parseAlertAccount(rule) {
  if (rule?.provider && (rule?.authIndex || rule?.auth_index)) {
    return normalizeQuotaAccount("cpa", rule.provider, rule.authIndex ?? rule.auth_index)
  }
  if (rule?.platform && (rule?.accountId || rule?.account_id)) {
    const accountId = rule.accountId ?? rule.account_id
    if (rule.source) return normalizeQuotaAccount(rule.source, rule.platform, accountId)
    return parseQuotaAccountReference(`${rule.platform}:${accountId}`)
  }
  return parseQuotaAccountReference(rule?.account)
}

export function evaluateQuotaAlerts(rules, results, states = new Map()) {
  const alerts = []
  const resultMap = new Map(
    results.map(result => [
      quotaAccountKey(result.source ?? result.account?.source, result.platform, result.account?.id),
      result,
    ]),
  )

  for (const rule of rules) {
    const account = parseAlertAccount(rule)
    if (!account) continue
    const key = quotaAccountKey(account.source, account.platform, account.accountId)
    const result = resultMap.get(key)
    if (!result || result.error) continue
    const percentages = getQuotaRemainingPercentages(result)
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
    "账号额度告警",
    `${alerts.length} 个账号低于告警阈值`,
    ...alerts.map(alert => {
      const name = maskedAccountName(alert.result)
      const title = [
        String(alert.result.source ?? alert.result.account?.source ?? "").toUpperCase(),
        alert.result.label,
        name,
      ]
        .filter(Boolean)
        .join(" · ")
      return [
        title,
        `当前最低  ${formatPercent(alert.remainingPercent)}`,
        `告警阈值  ${formatPercent(alert.thresholdPercent)}`,
      ].join("\n")
    }),
  ].join("\n\n")
}

export function buildQuotaAlertImageData(alerts, timeZone = "Asia/Shanghai", now = Date.now()) {
  return {
    theme: "alert",
    kicker: "ACCOUNT / QUOTA ALERT",
    title: "额度告警",
    subtitle: "账号剩余额度已低于阈值",
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

function accountTypeLabel(account) {
  const source = String(account?.source ?? "").toUpperCase()
  const type = String(account?.type ?? "").toLowerCase() === "oauth" ? "OAuth" : "Key"
  return [source, type, "账号"].filter(Boolean).join(" ")
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
