import assert from "node:assert/strict"
import test from "node:test"
import {
  buildS2aQuotaAccountOptions,
  buildS2aQuotaImageData,
  formatS2aQuota,
  getS2aQuotaRemainingPercentages,
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

function codexAccount(id, name = `account-${id}`, extra = {}) {
  return { id, name, platform: "openai", type: "oauth", status: "active", extra }
}

function claudeAccount(id = 25) {
  return {
    id,
    name: "Claude Pro 订阅",
    platform: "anthropic",
    type: "oauth",
    session_window_end: "2026-08-19T20:30:00+08:00",
    extra: {
      session_window_utilization: 0.07,
      passive_usage_7d_utilization: 0.01,
      passive_usage_7d_reset: 1787698800,
    },
  }
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

const codexQuotaPayload = {
  code: 0,
  data: {
    email: "user@example.com",
    plan_type: "pro",
    rate_limit: {
      primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1787196554 },
    },
    additional_rate_limits: [
      {
        limit_name: "Codex Spark",
        rate_limit: { primary_window: { used_percent: 90, limit_window_seconds: 604800 } },
      },
    ],
  },
}

test("分页查询 S2A 上支持额度的账号", async () => {
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
                codexAccount(1),
                { id: 9, name: "余额 Key", platform: "openai", type: "apikey" },
                { id: 23, name: "Grok", platform: "grok", type: "apikey" },
              ]
            : [kimiAccount(), zhipuAccount(), claudeAccount()],
        pages: 2,
      },
    })
  }

  try {
    const accounts = await listS2aQuotaAccounts(config)
    assert.deepEqual(
      accounts.map(item => item.id),
      [1, 26, 24, 25],
    )
    assert.equal(requests.length, 2)
    assert.equal(new URL(requests[0].url).searchParams.get("platform"), null)
    assert.equal(requests[0].options.headers["x-api-key"], "secret")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("锅巴账号选项带平台标签并使用平台加账号 ID 作为内部值", () => {
  assert.deepEqual(buildS2aQuotaAccountOptions([codexAccount(16, "Codex Pro"), kimiAccount()]), [
    { label: "Codex · Codex Pro", value: "openai:16" },
    { label: "Kimi · Kimi Code 订阅", value: "kimi:26" },
  ])
})

test("按平台解析额度窗口并过滤没有额度的账号", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    if (path === "/api/v1/admin/accounts") {
      return jsonResponse({
        code: 0,
        data: {
          items: [
            codexAccount(16, "ChatGPT Pro 20x 订阅"),
            claudeAccount(),
            kimiAccount(),
            zhipuAccount(),
            { id: 30, name: "无快照 Kimi", platform: "kimi", type: "apikey", extra: {} },
          ],
          pages: 1,
        },
      })
    }
    return jsonResponse(codexQuotaPayload)
  }

  try {
    const results = await queryS2aQuota(config, "Asia/Shanghai")
    assert.deepEqual(
      results.map(result => result.account.id),
      [16, 25, 26, 24],
    )

    const [codex, claude, kimi, zhipu] = results
    assert.equal(codex.plan, "pro")
    assert.deepEqual(
      codex.windows.map(window => [window.label, window.usedPercent]),
      [
        ["Codex 5 小时", 25],
        ["Codex Spark 每周", 90],
      ],
    )
    assert.deepEqual(
      claude.windows.map(window => [window.label, window.usedPercent]),
      [
        ["5 小时", 7.000000000000001],
        ["每周", 1],
      ],
    )
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
    assert.equal(claude.windows[0].resetAt.toISOString(), "2026-08-19T12:30:00.000Z")
    assert.equal(claude.windows[1].resetAt.toISOString(), "2026-08-25T23:00:00.000Z")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Codex 额度接口失败时回退账号快照，无快照才报错", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    if (path === "/api/v1/admin/accounts") {
      return jsonResponse({
        code: 0,
        data: {
          items: [
            codexAccount(1, "有快照", {
              codex_5h_window_minutes: 0,
              codex_5h_used_percent: 0,
              codex_7d_window_minutes: 10080,
              codex_7d_used_percent: 100,
              codex_7d_reset_at: "2026-08-20T11:29:13+08:00",
            }),
            codexAccount(2, "无快照"),
          ],
          pages: 1,
        },
      })
    }
    return jsonResponse({ message: "upstream failed" }, 502)
  }

  try {
    const results = await queryS2aQuota(config, "Asia/Shanghai")
    assert.equal(results.length, 2)
    assert.equal(results[0].error, undefined)
    assert.deepEqual(
      results[0].windows.map(window => [window.label, window.usedPercent]),
      [["Codex 每周", 100]],
    )
    assert.match(results[1].error, /upstream failed/)
    assert.deepEqual(results[1].windows, [])
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
    getS2aQuotaRemainingPercentages({
      windows: [{ usedPercent: 25 }, { usedPercent: 90 }, { usedPercent: null }],
    }),
    [75, 10],
  )
  assert.deepEqual(getS2aQuotaRemainingPercentages({ error: "failed", windows: [] }), [])
})

test("格式化 S2A 账号额度并脱敏账号", () => {
  const results = [
    {
      platform: "openai",
      label: "Codex",
      account: codexAccount(16, "ChatGPT Pro 20x 订阅"),
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
      platform: "kimi",
      label: "Kimi",
      account: { id: 26, name: "user@example.com", platform: "kimi", type: "apikey" },
      plan: null,
      timeZone: "Asia/Shanghai",
      windows: [{ label: "5 小时", usedPercent: 8, resetAt: null }],
    },
  ]

  const text = formatS2aQuota(results)
  assert.match(text, /^S2A 账号额度/m)
  assert.match(text, /Codex · ChatGPT Pro 20x 订阅/)
  assert.match(text, /Codex Spark 每周  剩余 10%/)
  assert.match(text, /Kimi · u\.\.\.r@example\.com/)
  assert.doesNotMatch(text, /user@example\.com/)

  const data = buildS2aQuotaImageData(results, "Asia/Shanghai", Date.parse("2026-08-14T04:30:00Z"))
  assert.equal(data.kicker, "S2A / QUOTA")
  assert.equal(data.summary[0].value, "2")
  assert.equal(data.summary[3].value, "10%")
  assert.equal(data.sections[0].kind, "Codex")
  assert.equal(data.sections[0].subtitle, "S2A OAuth 账号")
  assert.equal(data.sections[0].rows.length, 2)
  assert.equal(data.sections[1].kind, "Kimi")
  assert.equal(data.sections[1].subtitle, "S2A Key 账号")
  assert.doesNotMatch(JSON.stringify(data), /user@example\.com/)
})
