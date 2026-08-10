import assert from "node:assert/strict"
import test from "node:test"
import {
  buildQuotaAlertImageData,
  evaluateQuotaAlerts,
  formatQuotaAlerts,
  parseAlertAccount,
} from "../lib/alerts.js"

function codexResult(authIndex, remainingPercent, name = authIndex) {
  return {
    provider: "codex",
    file: { auth_index: authIndex, name },
    quota: { rate_limit: { primary_window: { used_percent: 100 - remainingPercent } } },
  }
}

test("解析按账号告警规则", () => {
  assert.deepEqual(parseAlertAccount({ account: "codex:codex-a" }), {
    provider: "codex",
    authIndex: "codex-a",
  })
  assert.equal(parseAlertAccount({ account: "kimi:kimi-a" }), null)
})

test("低额度只告警一次，恢复后允许再次告警", () => {
  const states = new Map()
  const rules = [{ account: "codex:codex-a", thresholdPercent: 20 }]

  assert.equal(evaluateQuotaAlerts(rules, [codexResult("codex-a", 10)], states).length, 1)
  assert.equal(evaluateQuotaAlerts(rules, [codexResult("codex-a", 10)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [codexResult("codex-a", 30)], states).length, 0)
  assert.equal(evaluateQuotaAlerts(rules, [codexResult("codex-a", 10)], states).length, 1)
})

test("每个账号使用自己的阈值", () => {
  const rules = [
    { account: "codex:codex-a", thresholdPercent: 20 },
    { account: "codex:codex-b", thresholdPercent: 5 },
  ]
  const results = [codexResult("codex-a", 10, "account-a"), codexResult("codex-b", 6, "account-b")]
  const alerts = evaluateQuotaAlerts(rules, results)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].account.authIndex, "codex-a")
  const text = formatQuotaAlerts(alerts)
  assert.match(text, /Codex · account-a/)
  assert.doesNotMatch(text, /```|^#{1,6}\s|\*\*/m)
})

test("构建按账号区分的额度告警图片数据", () => {
  const result = codexResult("codex-a", 8.5, "codex-account")
  const data = buildQuotaAlertImageData(
    [
      {
        account: { provider: "codex", authIndex: "codex-a" },
        result,
        remainingPercent: 8.5,
        thresholdPercent: 20,
      },
    ],
    "Asia/Shanghai",
    Date.parse("2026-08-08T04:30:00Z"),
  )

  assert.equal(data.title, "额度告警")
  assert.equal(data.sections[0].title, "codex-account")
  assert.equal(data.sections[0].subtitle, "Codex · codex-a")
  assert.equal(data.sections[0].rows[0].progress, 8.5)
  assert.equal(data.sections[0].rows[1].value, "20%")
})
