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
  const source = options.source ?? (type === "oauth" ? "cpa" : "s2a")
  return {
    source,
    platform,
    label,
    account: { id: accountId, name, platform, type, source },
    windows: [{ label: "5 小时", usedPercent: 100 - remainingPercent, resetAt: null }],
  }
}

test("解析 CPA OAuth 与 S2A Key 额度告警规则", () => {
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
  assert.deepEqual(parseAlertAccount({ account: "s2a:kimi:26" }), {
    source: "s2a",
    platform: "kimi",
    accountId: 26,
  })
  assert.deepEqual(parseAlertAccount({ account: "grok:23" }), {
    source: "cpa",
    platform: "xai",
    accountId: "23",
  })
  assert.equal(parseAlertAccount({ account: "gemini:23" }), null)
  assert.equal(parseAlertAccount({ account: "openai:16" }), null)
  assert.equal(parseAlertAccount({ account: "openai:not-an-id" }), null)
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
    { account: "s2a:kimi:26", thresholdPercent: 5 },
  ]
  const alerts = evaluateQuotaAlerts(rules, [
    quotaResult("codex-a", 10, "user-a@example.com"),
    quotaResult(26, 6, "Kimi Code 订阅", { platform: "kimi", label: "Kimi", type: "apikey" }),
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
    { account: "cpa:codex:codex-a", thresholdPercent: 20 },
    { account: "s2a:kimi:26", thresholdPercent: 20 },
  ]
  const alerts = evaluateQuotaAlerts(rules, [
    quotaResult("codex-a", 10),
    quotaResult(26, 4, "Kimi Code 订阅", { platform: "kimi", label: "Kimi", type: "apikey" }),
  ])
  assert.deepEqual(
    alerts.map(alert => alert.account.platform),
    ["codex", "kimi"],
  )
  assert.match(formatQuotaAlerts(alerts), /Kimi · Kimi Code 订阅/)
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

test("CPA Kimi 与 S2A Kimi 使用独立账号键", () => {
  const alerts = evaluateQuotaAlerts(
    [
      { account: "cpa:kimi:26", thresholdPercent: 20 },
      { account: "s2a:kimi:26", thresholdPercent: 20 },
    ],
    [
      quotaResult("26", 10, "CPA Kimi", { platform: "kimi", label: "Kimi" }),
      quotaResult(26, 5, "S2A Kimi", {
        source: "s2a",
        platform: "kimi",
        label: "Kimi",
        type: "apikey",
      }),
    ],
  )
  assert.deepEqual(
    alerts.map(alert => [alert.account.source, alert.account.accountId]),
    [
      ["cpa", "26"],
      ["s2a", 26],
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
})
