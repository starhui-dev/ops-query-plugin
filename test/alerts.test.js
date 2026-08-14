import assert from "node:assert/strict"
import test from "node:test"
import {
  buildQuotaAlertImageData,
  evaluateQuotaAlerts,
  formatQuotaAlerts,
  parseAlertAccount,
} from "../lib/alerts.js"

function usageResult(accountId, remainingPercent, name = `account-${accountId}`) {
  return {
    provider: "openai",
    account: { id: accountId, name },
    usage: { five_hour: { utilization: 100 - remainingPercent } },
  }
}

test("解析 S2A OpenAI OAuth 告警规则", () => {
  assert.deepEqual(parseAlertAccount({ account: "openai:16" }), {
    provider: "openai",
    accountId: 16,
  })
  assert.equal(parseAlertAccount({ account: "codex:16" }), null)
  assert.equal(parseAlertAccount({ account: "openai:not-an-id" }), null)
})

test("低额度只告警一次，恢复后允许再次告警", () => {
  const states = new Map()
  const rules = [{ account: "openai:16", thresholdPercent: 20 }]

  assert.equal(evaluateQuotaAlerts(rules, [usageResult(16, 10)], states).length, 1)
  assert.equal(evaluateQuotaAlerts(rules, [usageResult(16, 10)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [usageResult(16, 30)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [usageResult(16, 10)], states).length, 1)
})

test("每个 S2A 账号使用自己的阈值", () => {
  const rules = [
    { account: "openai:16", thresholdPercent: 20 },
    { account: "openai:17", thresholdPercent: 5 },
  ]
  const alerts = evaluateQuotaAlerts(rules, [
    usageResult(16, 10, "user-a@example.com"),
    usageResult(17, 6, "user-b@example.com"),
  ])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].account.accountId, 16)
  const text = formatQuotaAlerts(alerts)
  assert.match(text, /^S2A Codex 额度告警/m)
  assert.match(text, /u\.\.\.a@example\.com/)
  assert.doesNotMatch(text, /user-a@example\.com|openai:16/)
})

test("构建 S2A 额度告警图片数据", () => {
  const result = usageResult(16, 8.5, "ChatGPT Pro 20x 订阅")
  const data = buildQuotaAlertImageData(
    [
      {
        account: { provider: "openai", accountId: 16 },
        result,
        remainingPercent: 8.5,
        thresholdPercent: 20,
      },
    ],
    "Asia/Shanghai",
    Date.parse("2026-08-14T04:30:00Z"),
  )

  assert.equal(data.kicker, "S2A / QUOTA ALERT")
  assert.equal(data.sections[0].title, "ChatGPT Pro 20x 订阅")
  assert.equal(data.sections[0].subtitle, "S2A OAuth 账号")
  assert.doesNotMatch(JSON.stringify(data), /openai:16/)
  assert.equal(data.sections[0].rows[0].progress, 8.5)
})
