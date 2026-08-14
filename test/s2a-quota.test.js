import assert from "node:assert/strict"
import test from "node:test"
import {
  buildS2aQuotaAccountOptions,
  buildS2aQuotaImageData,
  formatS2aQuota,
  getS2aQuotaRemainingPercentages,
  getS2aUsageRemainingPercentages,
  listS2aOAuthAccounts,
  queryS2aQuota,
  queryS2aQuotaUsage,
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

function account(id, name = `account-${id}`) {
  return { id, name, platform: "openai", type: "oauth", status: "active" }
}

test("分页查询 S2A OpenAI OAuth 账号", async () => {
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
            ? [account(1), { id: 9, name: "api-key", platform: "openai", type: "apikey" }]
            : [account(2)],
        pages: 2,
      },
    })
  }

  try {
    const accounts = await listS2aOAuthAccounts(config)
    assert.deepEqual(
      accounts.map(item => item.id),
      [1, 2],
    )
    assert.equal(requests.length, 2)
    assert.equal(new URL(requests[0].url).searchParams.get("platform"), "openai")
    assert.equal(new URL(requests[0].url).searchParams.get("type"), "oauth")
    assert.equal(requests[0].options.headers["x-api-key"], "secret")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("锅巴账号选项显示 S2A 名称并使用账号 ID 作为内部值", () => {
  assert.deepEqual(buildS2aQuotaAccountOptions([account(16, "Codex Pro")]), [
    { label: "Codex Pro", value: "openai:16" },
  ])
})

test("精确额度查询隔离单个账号失败", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    if (path === "/api/v1/admin/accounts") {
      return jsonResponse({ code: 0, data: { items: [account(1), account(2)], pages: 1 } })
    }
    if (path.endsWith("/1/quota")) {
      return jsonResponse({
        code: 0,
        data: {
          email: "user@example.com",
          plan_type: "pro",
          rate_limit: {
            primary_window: { used_percent: 25, limit_window_seconds: 18000 },
          },
        },
      })
    }
    return jsonResponse({ message: "upstream failed" }, 502)
  }

  try {
    const results = await queryS2aQuota(config, "Asia/Shanghai")
    assert.equal(results.length, 2)
    assert.equal(results[0].quota.plan_type, "pro")
    assert.match(results[1].error, /upstream failed/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("批量用量查询只请求选中的账号并保留逐账号错误", async () => {
  const originalFetch = globalThis.fetch
  let requestBody
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname
    if (path === "/api/v1/admin/accounts") {
      return jsonResponse({ code: 0, data: { items: [account(1), account(2)], pages: 1 } })
    }
    requestBody = JSON.parse(options.body)
    return jsonResponse({
      code: 0,
      data: { usage: {}, errors: { 2: "quota unavailable" } },
    })
  }

  try {
    const results = await queryS2aQuotaUsage(config, [2])
    assert.deepEqual(requestBody, { account_ids: [2], force: false })
    assert.equal(results.length, 1)
    assert.equal(results[0].account.id, 2)
    assert.equal(results[0].error, "quota unavailable")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("计算精确配额和批量用量的最低剩余比例", () => {
  const quotaResult = {
    quota: {
      rate_limit: {
        primary_window: { used_percent: 25 },
        secondary_window: { used_percent: 50 },
      },
      additional_rate_limits: [{ rate_limit: { primary_window: { used_percent: 90 } } }],
    },
  }
  assert.deepEqual(getS2aQuotaRemainingPercentages(quotaResult), [75, 50, 10])
  assert.deepEqual(
    getS2aUsageRemainingPercentages({
      usage: { five_hour: { utilization: 80 }, seven_day: { utilization: 20 } },
    }),
    [20, 80],
  )
})

test("格式化 S2A Codex 额度并脱敏账号", () => {
  const results = [
    {
      account: account(16, "ChatGPT Pro 20x 订阅"),
      quota: {
        email: "user@example.com",
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 18000,
            reset_at: 1787196554,
          },
        },
        additional_rate_limits: [
          {
            limit_name: "Codex Spark",
            rate_limit: {
              primary_window: { used_percent: 90, limit_window_seconds: 604800 },
            },
          },
        ],
      },
      timeZone: "Asia/Shanghai",
    },
  ]

  const text = formatS2aQuota(results)
  assert.match(text, /^S2A Codex 额度/m)
  assert.match(text, /ChatGPT Pro 20x 订阅/)
  assert.match(text, /Codex Spark 每周  剩余 10%/)
  assert.doesNotMatch(text, /user@example\.com/)

  const data = buildS2aQuotaImageData(results, "Asia/Shanghai", Date.parse("2026-08-14T04:30:00Z"))
  assert.equal(data.kicker, "S2A / CODEX")
  assert.equal(data.summary[3].value, "10%")
  assert.equal(data.sections[0].title, "ChatGPT Pro 20x 订阅")
  assert.equal(data.sections[0].rows.length, 2)
  assert.doesNotMatch(JSON.stringify(data), /user@example\.com/)
})
