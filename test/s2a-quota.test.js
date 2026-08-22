import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAccountQuotaImageData,
  buildS2aQuotaAccountOptions,
  formatAccountQuota,
  getQuotaRemainingPercentages,
  listS2aQuotaAccounts,
  queryS2aQuota,
} from "../lib/s2a-quota.js"

const config = {
  baseUrl: "https://s2a.example.com",
  adminApiKey: "secret",
  timeoutMs: 10000,
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function kimiAccount(id = 26) {
  return {
    id,
    name: "Kimi Code 订阅",
    platform: "kimi",
    type: "apikey",
    extra: {
      kimi_5h_used_percent: 8,
      kimi_5h_reset_at: "2026-08-19T10:52:41Z",
      kimi_weekly_used_percent: 50,
      kimi_weekly_reset_at: "2026-08-22T03:52:41Z",
    },
  }
}

function zhipuAccount(id = 24) {
  return {
    id,
    name: "Zhipu GLM Coding Plan",
    platform: "zhipu",
    type: "apikey",
    extra: { zhipu_5h_used_percent: 2, zhipu_5h_reset_at: "2026-08-19T11:55:02Z" },
  }
}

test("分页查询 S2A 上支持额度的 Key 账号并排除 OAuth", async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options })
    const page = new URL(url).searchParams.get("page")
    return jsonResponse({
      code: 0,
      data: {
        items:
          page === "1"
            ? [
                { id: 1, name: "Codex OAuth", platform: "openai", type: "oauth" },
                { id: 9, name: "余额 Key", platform: "openai", type: "apikey" },
                { id: 23, name: "Grok", platform: "grok", type: "apikey" },
              ]
            : [
                kimiAccount(),
                zhipuAccount(),
                { id: 25, name: "Claude OAuth", platform: "anthropic", type: "oauth" },
              ],
        pages: 2,
      },
    })
  }

  try {
    const accounts = await listS2aQuotaAccounts(config)
    assert.deepEqual(
      accounts.map(item => item.id),
      [26, 24],
    )
    assert.equal(requests.length, 2)
    assert.equal(new URL(requests[0].url).searchParams.get("platform"), null)
    assert.equal(requests[0].options.headers["x-api-key"], "secret")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("锅巴只生成 S2A Key 账号选项", () => {
  assert.deepEqual(
    buildS2aQuotaAccountOptions([
      { id: 16, name: "Codex Pro", platform: "openai", type: "oauth" },
      kimiAccount(),
    ]),
    [{ label: "S2A · Kimi · Kimi Code 订阅", value: "s2a:kimi:26" }],
  )
})

test("按平台解析 S2A Key 额度窗口并过滤没有额度的账号", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    if (path === "/api/v1/admin/accounts") {
      return jsonResponse({
        code: 0,
        data: {
          items: [
            { id: 16, name: "ChatGPT Pro", platform: "openai", type: "oauth" },
            kimiAccount(),
            zhipuAccount(),
            { id: 30, name: "无快照 Kimi", platform: "kimi", type: "apikey", extra: {} },
          ],
          pages: 1,
        },
      })
    }
    throw new Error(`unexpected request: ${path}`)
  }

  try {
    const results = await queryS2aQuota(config, "Asia/Shanghai")
    assert.deepEqual(
      results.map(result => result.account.id),
      [26, 24],
    )

    const [kimi, zhipu] = results
    assert.deepEqual(
      kimi.windows.map(window => [window.label, window.usedPercent]),
      [
        ["5 小时", 8],
        ["每周", 50],
      ],
    )
    assert.deepEqual(
      zhipu.windows.map(window => [window.label, window.usedPercent]),
      [["5 小时", 2]],
    )
    assert.equal(kimi.source, "s2a")
    assert.equal(kimi.account.source, "s2a")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("只查询选中的账号", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    if (path === "/api/v1/admin/accounts") {
      return jsonResponse({ code: 0, data: { items: [kimiAccount(), zhipuAccount()], pages: 1 } })
    }
    throw new Error(`unexpected request: ${path}`)
  }

  try {
    const results = await queryS2aQuota(config, "Asia/Shanghai", [24])
    assert.equal(results.length, 1)
    assert.equal(results[0].platform, "zhipu")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("计算额度窗口的剩余比例", () => {
  assert.deepEqual(
    getQuotaRemainingPercentages({
      windows: [{ usedPercent: 25 }, { usedPercent: 90 }, { usedPercent: null }],
    }),
    [75, 10],
  )
  assert.deepEqual(getQuotaRemainingPercentages({ error: "failed", windows: [] }), [])
})

test("合并格式化 CPA OAuth 与 S2A Key 账号额度并脱敏账号", () => {
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
      source: "s2a",
      platform: "kimi",
      label: "Kimi",
      account: {
        id: 26,
        name: "user@example.com",
        platform: "kimi",
        type: "apikey",
        source: "s2a",
      },
      plan: null,
      timeZone: "Asia/Shanghai",
      windows: [{ label: "5 小时", usedPercent: 8, resetAt: null, detail: "用量 8 / 100" }],
    },
  ]

  const text = formatAccountQuota(results)
  assert.match(text, /^账号额度/m)
  assert.match(text, /CPA · Codex · ChatGPT Pro 20x 订阅/)
  assert.match(text, /Codex Spark 每周  剩余 10%/)
  assert.match(text, /S2A · Kimi · u\.\.\.r@example\.com/)
  assert.match(text, /剩余 92%  用量 8 \/ 100/)
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
  assert.equal(data.sections[1].kind, "Kimi")
  assert.equal(data.sections[1].subtitle, "S2A Key 账号")
  assert.match(data.sections[1].rows[0].detail, /用量 8 \/ 100/)
  assert.doesNotMatch(JSON.stringify(data), /user@example\.com/)
})
