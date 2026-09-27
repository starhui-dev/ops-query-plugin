import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAccountQuotaImageData,
  formatAccountQuota,
  getQuotaRemainingPercentages,
} from "../lib/account-quota.js"

test("计算额度窗口的剩余比例", () => {
  assert.deepEqual(
    getQuotaRemainingPercentages({
      windows: [{ usedPercent: 25 }, { usedPercent: 90 }, { usedPercent: null }, {}],
    }),
    [75, 10],
  )
  assert.deepEqual(getQuotaRemainingPercentages({ error: "failed", windows: [] }), [])
})

test("合并格式化 CPA 与 NewAPI 账号额度并脱敏账号", () => {
  const results = [
    {
      source: "cpa",
      platform: "codex",
      label: "Codex",
      account: {
        id: "codex-a",
        name: "ChatGPT Pro 20x 订阅",
        platform: "codex",
        type: "oauth",
        source: "cpa",
      },
      plan: "pro",
      timeZone: "Asia/Shanghai",
      windows: [
        {
          label: "Codex 5 小时",
          usedPercent: 25,
          resetAt: new Date("2026-08-14T04:49:14Z"),
        },
        { label: "Codex Spark 每周", usedPercent: 90, resetAt: null },
      ],
    },
    {
      source: "newapi",
      platform: "deepseek",
      label: "DeepSeek",
      account: {
        id: 7,
        name: "user@example.com",
        platform: "deepseek",
        type: "apikey",
        source: "newapi",
      },
      plan: null,
      timeZone: "Asia/Shanghai",
      windows: [
        {
          label: "余额 USD",
          usedPercent: null,
          balance: 12.5,
          currency: "USD",
          available: true,
          detail: "更新于 08/14 12:00",
          resetAt: null,
        },
      ],
    },
  ]

  const text = formatAccountQuota(results)
  assert.match(text, /^账号额度/m)
  assert.match(text, /CPA · Codex · ChatGPT Pro 20x 订阅/)
  assert.match(text, /Codex Spark 每周  剩余 10%/)
  assert.match(text, /NewAPI · DeepSeek · u\.\.\.r@example\.com/)
  assert.match(text, /余额 USD  USD 12\.5  更新于 08\/14 12:00/)
  assert.doesNotMatch(text, /user@example\.com/)

  const data = buildAccountQuotaImageData(
    results,
    "Asia/Shanghai",
    Date.parse("2026-08-14T04:30:00Z"),
  )
  assert.equal(data.kicker, "ACCOUNT / QUOTA")
  assert.equal(data.summary[0].value, "2")
  assert.equal(data.summary[3].value, "10%")
  assert.equal(data.sections[0].kind, "Codex")
  assert.equal(data.sections[0].subtitle, "CPA OAuth 账号")
  assert.equal(data.sections[0].rows.length, 2)
  assert.equal(data.sections[1].kind, "DeepSeek")
  assert.equal(data.sections[1].subtitle, "NewAPI Key 账号")
  assert.equal(data.sections[1].rows[0].progress, null)
  assert.match(data.sections[1].rows[0].detail, /更新于 08\/14 12:00/)
  assert.doesNotMatch(JSON.stringify(data), /user@example\.com/)
})
