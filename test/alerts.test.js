import assert from "node:assert/strict"
import test from "node:test"
import {
  buildQuotaAlertImageData,
  evaluateQuotaAlerts,
  formatQuotaAlerts,
  parseAlertAccount,
} from "../lib/alerts.js"

function quotaResult(accountId, remainingPercent, name = `account-${accountId}`, options = {}) {
  const { platform = "openai", label = "Codex", type = "oauth" } = options
  return {
    platform,
    label,
    account: { id: accountId, name, platform, type },
    windows: [{ label: "5 小时", usedPercent: 100 - remainingPercent, resetAt: null }],
  }
}

test("解析各平台的 S2A 额度告警规则", () => {
  assert.deepEqual(parseAlertAccount({ account: "openai:16" }), {
    platform: "openai",
    accountId: 16,
  })
  assert.deepEqual(parseAlertAccount({ account: "kimi:26" }), { platform: "kimi", accountId: 26 })
  assert.equal(parseAlertAccount({ account: "grok:23" }), null)
  assert.equal(parseAlertAccount({ account: "codex:16" }), null)
  assert.equal(parseAlertAccount({ account: "openai:not-an-id" }), null)
})

test("低额度只告警一次，恢复后允许再次告警", () => {
  const states = new Map()
  const rules = [{ account: "openai:16", thresholdPercent: 20 }]

  assert.equal(evaluateQuotaAlerts(rules, [quotaResult(16, 10)], states).length, 1)
  assert.equal(evaluateQuotaAlerts(rules, [quotaResult(16, 10)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [quotaResult(16, 30)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [quotaResult(16, 10)], states).length, 1)
})

test("每个 S2A 账号使用自己的阈值", () => {
  const rules = [
    { account: "openai:16", thresholdPercent: 20 },
    { account: "kimi:26", thresholdPercent: 5 },
  ]
  const alerts = evaluateQuotaAlerts(rules, [
    quotaResult(16, 10, "user-a@example.com"),
    quotaResult(26, 6, "Kimi Code 订阅", { platform: "kimi", label: "Kimi", type: "apikey" }),
  ])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].account.accountId, 16)
  const text = formatQuotaAlerts(alerts)
  assert.match(text, /^S2A 账号额度告警/m)
  assert.match(text, /Codex · u\.\.\.a@example\.com/)
  assert.doesNotMatch(text, /user-a@example\.com|openai:16/)
})

test("不同平台的账号可以同时触发告警", () => {
  const rules = [
    { account: "openai:16", thresholdPercent: 20 },
    { account: "kimi:26", thresholdPercent: 20 },
  ]
  const alerts = evaluateQuotaAlerts(rules, [
    quotaResult(16, 10),
    quotaResult(26, 4, "Kimi Code 订阅", { platform: "kimi", label: "Kimi", type: "apikey" }),
  ])
  assert.deepEqual(
    alerts.map(alert => alert.account.platform),
    ["openai", "kimi"],
  )
  assert.match(formatQuotaAlerts(alerts), /Kimi · Kimi Code 订阅/)
})

test("查询失败或没有额度窗口的账号不触发告警", () => {
  const rules = [{ account: "openai:16", thresholdPercent: 20 }]
  assert.equal(
    evaluateQuotaAlerts(rules, [{ platform: "openai", account: { id: 16 }, error: "failed" }])
      .length,
    0,
  )
  assert.equal(
    evaluateQuotaAlerts(rules, [{ platform: "openai", account: { id: 16 }, windows: [] }]).length,
    0,
  )
})

test("构建 S2A 额度告警图片数据", () => {
  const result = quotaResult(16, 8.5, "ChatGPT Pro 20x 订阅")
  const data = buildQuotaAlertImageData(
    [
      {
        account: { platform: "openai", accountId: 16 },
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
  assert.equal(data.sections[0].kind, "Codex")
  assert.equal(data.sections[0].subtitle, "S2A OAuth 账号")
  assert.doesNotMatch(JSON.stringify(data), /openai:16/)
  assert.equal(data.sections[0].rows[0].progress, 8.5)
})
