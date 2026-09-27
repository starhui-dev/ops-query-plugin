import assert from "node:assert/strict"
import test from "node:test"
import {
  buildQuotaAlertImageData,
  evaluateQuotaAlerts,
  formatQuotaAlerts,
  parseAlertAccount,
} from "../lib/alerts.js"

function quotaResult(accountId, remainingPercent, name = `account-${accountId}`, options = {}) {
  const { platform = "codex", label = "Codex", type = "oauth" } = options
  const source = options.source ?? "cpa"
  return {
    source,
    platform,
    label,
    account: { id: accountId, name, platform, type, source },
    windows: [{ label: "5 小时", usedPercent: 100 - remainingPercent, resetAt: null }],
  }
}

test("解析 CPA 与 NewAPI 多类型额度告警规则", () => {
  assert.deepEqual(parseAlertAccount({ account: "cpa:claude:claude-a" }), {
    source: "cpa",
    platform: "claude",
    accountId: "claude-a",
  })
  assert.deepEqual(parseAlertAccount({ provider: "kimi", authIndex: "kimi-a" }), {
    source: "cpa",
    platform: "kimi",
    accountId: "kimi-a",
  })
  assert.deepEqual(parseAlertAccount({ account: "cpa:xai:xai:1" }), {
    source: "cpa",
    platform: "xai",
    accountId: "xai:1",
  })
  assert.deepEqual(parseAlertAccount({ account: "codex:codex-a" }), {
    source: "cpa",
    platform: "codex",
    accountId: "codex-a",
  })
  assert.deepEqual(parseAlertAccount({ account: "newapi:codex:12" }), {
    source: "newapi",
    platform: "codex",
    accountId: 12,
  })
  assert.deepEqual(parseAlertAccount({ account: "newapi:deepseek:7" }), {
    source: "newapi",
    platform: "deepseek",
    accountId: 7,
  })
  assert.deepEqual(parseAlertAccount({ account: "grok:23" }), {
    source: "cpa",
    platform: "xai",
    accountId: "23",
  })
  assert.equal(parseAlertAccount({ account: "openai:not-an-id" }), null)
  assert.deepEqual(parseAlertAccount({ account: "newapi:glm:12" }), {
    source: "newapi",
    platform: "glm",
    accountId: 12,
  })
  assert.equal(parseAlertAccount({ account: "newapi:gemini:12" }), null)
  assert.equal(parseAlertAccount({ account: "newapi:codex:abc" }), null)
})

test("已移除的 S2A 告警引用不再解析，也不会误落到 CPA", () => {
  for (const account of ["s2a:kimi:26", "s2a:openai:16", "kimi:26", "gemini:23", "openai:16"]) {
    assert.equal(parseAlertAccount({ account }), null, account)
  }
  assert.equal(parseAlertAccount({ platform: "kimi", accountId: 26 }), null)
})

test("低额度只告警一次，恢复后允许再次告警", () => {
  const states = new Map()
  const rules = [{ account: "cpa:codex:codex-a", thresholdPercent: 20 }]

  assert.equal(evaluateQuotaAlerts(rules, [quotaResult("codex-a", 10)], states).length, 1)
  assert.equal(evaluateQuotaAlerts(rules, [quotaResult("codex-a", 10)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [quotaResult("codex-a", 30)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [quotaResult("codex-a", 10)], states).length, 1)
})

test("每个额度账号使用自己的阈值", () => {
  const rules = [
    { account: "cpa:codex:codex-a", thresholdPercent: 20 },
    { account: "newapi:codex:26", thresholdPercent: 5 },
  ]
  const alerts = evaluateQuotaAlerts(rules, [
    quotaResult("codex-a", 10, "user-a@example.com"),
    quotaResult(26, 6, "NewAPI Codex", { source: "newapi" }),
  ])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].account.accountId, "codex-a")
  const text = formatQuotaAlerts(alerts)
  assert.match(text, /^账号额度告警/m)
  assert.match(text, /CPA · Codex · u\.\.\.a@example\.com/)
  assert.doesNotMatch(text, /user-a@example\.com|codex:codex-a/)
})

test("不同平台的账号可以同时触发告警", () => {
  const rules = [
    { account: "cpa:kimi:kimi-a", thresholdPercent: 20 },
    { account: "newapi:codex:26", thresholdPercent: 20 },
  ]
  const alerts = evaluateQuotaAlerts(rules, [
    quotaResult("kimi-a", 10, "Kimi Code 订阅", { platform: "kimi", label: "Kimi" }),
    quotaResult(26, 4, "ChatGPT Plus", { source: "newapi" }),
  ])
  assert.deepEqual(
    alerts.map(alert => [alert.account.source, alert.account.platform]),
    [
      ["cpa", "kimi"],
      ["newapi", "codex"],
    ],
  )
  const text = formatQuotaAlerts(alerts)
  assert.match(text, /CPA · Kimi · Kimi Code 订阅/)
  assert.match(text, /NewAPI · Codex · ChatGPT Plus/)
})

test("查询失败或没有额度窗口的账号不触发告警", () => {
  const rules = [{ account: "cpa:codex:codex-a", thresholdPercent: 20 }]
  assert.equal(
    evaluateQuotaAlerts(rules, [
      { source: "cpa", platform: "codex", account: { id: "codex-a" }, error: "failed" },
    ]).length,
    0,
  )
  assert.equal(
    evaluateQuotaAlerts(rules, [
      { source: "cpa", platform: "codex", account: { id: "codex-a" }, windows: [] },
    ]).length,
    0,
  )
})

test("CPA Codex 与 NewAPI Codex 使用独立账号键", () => {
  const alerts = evaluateQuotaAlerts(
    [
      { account: "cpa:codex:26", thresholdPercent: 20 },
      { account: "newapi:codex:26", thresholdPercent: 20 },
    ],
    [quotaResult("26", 10, "CPA Codex"), quotaResult(26, 5, "NewAPI Codex", { source: "newapi" })],
  )
  assert.deepEqual(
    alerts.map(alert => [alert.account.source, alert.account.accountId]),
    [
      ["cpa", "26"],
      ["newapi", 26],
    ],
  )
})

test("构建统一额度告警图片数据", () => {
  const result = quotaResult("codex-a", 8.5, "ChatGPT Pro 20x 订阅")
  const data = buildQuotaAlertImageData(
    [
      {
        account: { source: "cpa", platform: "codex", accountId: "codex-a" },
        result,
        remainingPercent: 8.5,
        thresholdPercent: 20,
      },
    ],
    "Asia/Shanghai",
    Date.parse("2026-08-14T04:30:00Z"),
  )

  assert.equal(data.kicker, "ACCOUNT / QUOTA ALERT")
  assert.equal(data.sections[0].title, "ChatGPT Pro 20x 订阅")
  assert.equal(data.sections[0].kind, "Codex")
  assert.equal(data.sections[0].subtitle, "CPA OAuth 账号")
  assert.doesNotMatch(JSON.stringify(data), /codex:codex-a/)
  assert.equal(data.sections[0].rows[0].progress, 8.5)

  const newapiData = buildQuotaAlertImageData([
    {
      account: { source: "newapi", platform: "codex", accountId: 12 },
      result: quotaResult(12, 5, "NewAPI Codex", { source: "newapi" }),
      remainingPercent: 5,
      thresholdPercent: 20,
    },
  ])
  assert.equal(newapiData.sections[0].subtitle, "NewAPI OAuth 账号")
})
