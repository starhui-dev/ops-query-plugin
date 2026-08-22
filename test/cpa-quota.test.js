import assert from "node:assert/strict"
import test from "node:test"
import {
  getProviderAuthFiles,
  listCpaQuotaAccounts,
  parseApiCallResult,
  queryCpaQuota,
} from "../lib/cpa-quota.js"

const config = {
  baseUrl: "https://cpa.example.com",
  managementKey: "secret",
  timeoutMs: 10000,
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function accountToken(accountId) {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url")
  return `header.${payload}.signature`
}

function createCpaFetch(files, responder, calls = []) {
  return async (url, requestOptions) => {
    if (new URL(url).pathname === "/v0/management/auth-files") return jsonResponse({ files })
    const request = JSON.parse(requestOptions.body)
    calls.push(request)
    const response = await responder(request)
    return jsonResponse({
      status_code: response?.status ?? 200,
      body: JSON.stringify(response?.body ?? response),
    })
  }
}

test("CPA 列出全部支持配额且未停用的 OAuth 提供商", async () => {
  const requests = []
  const options = await listCpaQuotaAccounts(config, async (url, requestOptions) => {
    requests.push({ url: String(url), options: requestOptions })
    return jsonResponse({
      files: [
        {
          provider: "antigravity",
          auth_index: "ag-a",
          note: "国内主号",
          label: "Antigravity Pro",
          email: "ag@example.com",
        },
        {
          provider: "claude",
          auth_index: "claude-a",
          label: "Claude Max",
          email: "claude@example.com",
        },
        { provider: "codex", auth_index: "codex-a", note: "", email: "codex@example.com" },
        { provider: "kimi", auth_index: "kimi-a", email: "kimi@example.com" },
        { provider: "x-ai", auth_index: "xai:1", email: "xai@example.com" },
        { provider: "gemini", auth_index: "gemini-a" },
        { provider: "codex", auth_index: "codex-disabled", disabled: true },
      ],
    })
  })

  assert.deepEqual(options, [
    { label: "CPA · Antigravity · 国内主号", value: "cpa:antigravity:ag-a" },
    { label: "CPA · Claude · Claude Max", value: "cpa:claude:claude-a" },
    { label: "CPA · Codex · codex@example.com", value: "cpa:codex:codex-a" },
    { label: "CPA · Kimi · kimi@example.com", value: "cpa:kimi:kimi-a" },
    { label: "CPA · xAI · xai@example.com", value: "cpa:xai:xai:1" },
  ])
  assert.equal(new URL(requests[0].url).pathname, "/v0/management/auth-files")
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret")
})

test("CPA 查询 Codex 全部额度窗口", async () => {
  const calls = []
  const files = [
    {
      provider: "codex",
      auth_index: "codex-a",
      note: "主力 Codex",
      label: "Codex Pro",
      email: "user@example.com",
      id_token: accountToken("account-a"),
    },
    { provider: "codex", auth_index: "codex-b" },
  ]
  const results = await queryCpaQuota(
    config,
    "Asia/Shanghai",
    [{ source: "cpa", platform: "codex", accountId: "codex-a" }],
    createCpaFetch(
      files,
      request => ({
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 18000,
            reset_at: 1893456000,
          },
        },
        additional_rate_limits: [
          {
            limit_name: "Codex Spark",
            rate_limit: {
              secondary_window: { used_percent: 90, limit_window_seconds: 604800 },
            },
          },
        ],
      }),
      calls,
    ),
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].auth_index, "codex-a")
  assert.equal(calls[0].header["Chatgpt-Account-Id"], "account-a")
  assert.equal(calls[0].header.Authorization, "Bearer $TOKEN$")
  assert.deepEqual(
    {
      source: results[0].source,
      platform: results[0].platform,
      label: results[0].label,
      account: results[0].account,
      plan: results[0].plan,
    },
    {
      source: "cpa",
      platform: "codex",
      label: "Codex",
      account: {
        id: "codex-a",
        name: "主力 Codex",
        platform: "codex",
        type: "oauth",
        source: "cpa",
      },
      plan: "pro",
    },
  )
  assert.deepEqual(
    results[0].windows.map(window => [window.label, window.usedPercent]),
    [
      ["Codex 5 小时", 25],
      ["Codex Spark 每周", 90],
    ],
  )
  assert.equal(results[0].windows[0].resetAt.toISOString(), "2030-01-01T00:00:00.000Z")
})

test("CPA 查询 Claude 窗口、Fable 与额外用量", async () => {
  const calls = []
  const results = await queryCpaQuota(
    config,
    "Asia/Shanghai",
    [],
    createCpaFetch(
      [{ provider: "claude", auth_index: "claude-a", email: "claude@example.com" }],
      request => {
        if (request.url.endsWith("/profile")) {
          return { account: { has_claude_max: false, has_claude_pro: true } }
        }
        return {
          five_hour: { utilization: 20, resets_at: "2030-01-01T00:00:00Z" },
          seven_day_sonnet: { utilization: 80, resets_at: "2030-01-02T00:00:00Z" },
          limits: [
            {
              kind: "weekly_scoped",
              percent: 40,
              resets_at: "2030-01-03T00:00:00Z",
              is_active: true,
              scope: { model: { display_name: "Fable" } },
            },
          ],
          extra_usage: {
            is_enabled: true,
            monthly_limit: 10000,
            used_credits: 2500,
            utilization: 25,
          },
        }
      },
      calls,
    ),
  )

  assert.equal(calls.length, 2)
  assert.equal(results[0].platform, "claude")
  assert.equal(results[0].plan, "Pro")
  assert.deepEqual(
    results[0].windows.map(window => [window.label, window.usedPercent]),
    [
      ["5 小时", 20],
      ["Sonnet 每周", 80],
      ["Fable 每周", 40],
      ["额外用量", 25],
    ],
  )
  assert.equal(results[0].windows.at(-1).detail, "$25.00 / $100.00")
})

test("CPA 查询 Antigravity 分组额度和套餐", async () => {
  const calls = []
  const results = await queryCpaQuota(
    config,
    "Asia/Shanghai",
    [],
    createCpaFetch(
      [
        {
          provider: "antigravity",
          auth_index: "ag-a",
          email: "ag@example.com",
          project_id: "project-a",
        },
      ],
      request => {
        if (request.url.endsWith(":loadCodeAssist")) {
          return { paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }
        }
        return {
          groups: [
            {
              displayName: "Gemini",
              buckets: [
                {
                  displayName: "5h",
                  remainingFraction: 0.75,
                  resetTime: "2030-01-01T00:00:00Z",
                },
              ],
            },
          ],
        }
      },
      calls,
    ),
  )

  assert.equal(results[0].platform, "antigravity")
  assert.equal(results[0].plan, "Google AI Pro")
  assert.deepEqual(
    results[0].windows.map(window => [window.label, window.usedPercent]),
    [["Gemini · 5h", 25]],
  )
  assert.deepEqual(JSON.parse(calls[0].data), { project: "project-a" })
})

test("CPA 查询 Kimi 的全部限制和汇总额度", async () => {
  const results = await queryCpaQuota(
    config,
    "Asia/Shanghai",
    [],
    createCpaFetch([{ provider: "kimi", auth_index: "kimi-a" }], () => ({
      limits: [
        {
          detail: { used: 25, limit: 100, reset_in: 3600 },
          window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        },
      ],
      usage: { used: 50, limit: 200, reset_at: "2030-01-01T00:00:00Z" },
    })),
  )

  assert.equal(results[0].platform, "kimi")
  assert.deepEqual(
    results[0].windows.map(window => [window.label, window.usedPercent, window.detail]),
    [
      ["5 小时", 25, "用量 25 / 100"],
      ["每周额度", 25, "用量 50 / 200"],
    ],
  )
})

test("CPA 查询 xAI 周期、产品、月度和按需额度", async () => {
  const results = await queryCpaQuota(
    config,
    "Asia/Shanghai",
    [{ source: "cpa", platform: "xai", accountId: "xai:1" }],
    createCpaFetch(
      [
        { provider: "grok", auth_index: "xai:1" },
        { provider: "xai", auth_index: "xai:2" },
      ],
      request => {
        if (request.url.includes("format=credits")) {
          return {
            config: {
              currentPeriod: { type: "weekly", end: "2030-01-01T00:00:00Z" },
              creditUsagePercent: 30,
              productUsage: [{ product: "Grok", usagePercent: 70 }],
            },
          }
        }
        return {
          config: {
            currentPeriod: { type: "monthly", end: "2030-02-01T00:00:00Z" },
            monthlyLimit: { val: 10000 },
            used: { val: 12500 },
            onDemandCap: { val: 5000 },
            onDemandUsed: { val: 2500 },
          },
        }
      },
    ),
  )

  assert.equal(results.length, 1)
  assert.equal(results[0].platform, "xai")
  assert.deepEqual(
    results[0].windows.map(window => [window.label, window.usedPercent, window.detail]),
    [
      ["每周额度", 30, undefined],
      ["Grok额度", 70, undefined],
      ["每月额度", 100, "$100.00 / $100.00"],
      ["按需额度", 50, "$25.00 / $50.00"],
    ],
  )
})

test("CPA 查询 xAI 时省略的周用量按 0% 展示", async () => {
  const results = await queryCpaQuota(
    config,
    "Asia/Shanghai",
    [{ source: "cpa", platform: "xai", accountId: "xai:1" }],
    createCpaFetch([{ provider: "xai", auth_index: "xai:1", email: "xai@example.com" }], request => {
      if (request.url.includes("format=credits")) {
        return {
          config: {
            currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-08-27T07:45:00Z" },
          },
        }
      }
      return {
        config: {
          currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY", end: "2026-08-31T16:00:00Z" },
          monthlyLimit: {},
          onDemandCap: {},
          on_demand_enabled: false,
        },
      }
    }),
  )

  assert.equal(results[0].error, undefined)
  assert.deepEqual(
    results[0].windows.map(window => [window.label, window.usedPercent, window.detail]),
    [["每周额度", 0, undefined]],
  )
  assert.equal(results[0].windows[0].resetAt.toISOString(), "2026-08-27T07:45:00.000Z")
})

test("CPA OAuth 查询失败会保留账号级错误", async () => {
  const results = await queryCpaQuota(
    config,
    "Asia/Shanghai",
    [],
    createCpaFetch([{ provider: "codex", auth_index: "codex-a" }], () => ({
      status: 401,
      body: { details: [{ debug: { reason: "REASON_INVALID_AUTH_TOKEN" } }] },
    })),
  )

  assert.match(results[0].error, /凭据已失效.*重新登录/)
  assert.deepEqual(results[0].windows, [])
})

test("CPA 按提供商和 auth_index 选择账号", () => {
  const files = getProviderAuthFiles(
    [
      { provider: "codex", auth_index: "shared" },
      { provider: "claude", auth_index: "shared" },
      { provider: "codex", auth_index: "codex-b" },
      { provider: "codex", auth_index: "codex-c", disabled: true },
    ],
    "codex",
    ["shared"],
  )
  assert.deepEqual(
    files.map(file => file.provider),
    ["codex"],
  )
})

test("解析 CPA api-call 字符串响应", () => {
  assert.deepEqual(parseApiCallResult({ status_code: 200, body: '{"plan_type":"plus"}' }), {
    plan_type: "plus",
  })
})
