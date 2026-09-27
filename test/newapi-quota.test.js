import assert from "node:assert/strict"
import test from "node:test"
import {
  listNewapiChannelOptions,
  listNewapiQuotaAccountOptions,
  listNewapiQuotaChannels,
  queryNewapiQuota,
} from "../lib/newapi-quota.js"

const config = {
  baseUrl: "https://newapi.example.com",
  accessToken: "secret",
  timeoutMs: 10000,
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function codexUsage(usedPercent = 25) {
  return {
    plan_type: "plus",
    rate_limit: {
      primary_window: {
        used_percent: usedPercent,
        limit_window_seconds: 18000,
        reset_at: 1893456000,
      },
      secondary_window: { used_percent: 60, limit_window_seconds: 604800 },
    },
  }
}

const channels = [
  { id: 1, type: 57, name: "Codex 主力", status: 1 },
  { id: 2, type: 57, name: "Codex 自动禁用", status: 3 },
  { id: 3, type: 57, name: "Codex 手动禁用", status: 2 },
  { id: 4, type: 57, name: "Codex 多密钥", status: 1, channel_info: { is_multi_key: true } },
  { id: 5, type: 43, name: "DeepSeek", status: 1, balance: 3.5, balance_updated_time: 1786680000 },
  { id: 6, type: 43, name: "DeepSeek 未刷新", status: 1, balance: 0, balance_updated_time: 0 },
  {
    id: 7,
    type: 40,
    name: "SiliconFlow",
    status: 1,
    balance: 20,
    balance_updated_time: 1786680000,
  },
  {
    id: 8,
    type: 14,
    name: "Anthropic Key",
    status: 1,
    balance: 9,
    balance_updated_time: 1786680000,
  },
  { id: 9, type: 57, name: "Codex 凭据失效", status: 1 },
]

function createNewapiFetch(requests = [], items = channels) {
  return async (url, options) => {
    const parsed = new URL(url)
    requests.push({ url: parsed, options })
    if (parsed.pathname === "/api/channel/") {
      const page = Number(parsed.searchParams.get("p"))
      const pageSize = Number(parsed.searchParams.get("page_size"))
      return jsonResponse({
        success: true,
        message: "",
        data: {
          items: items.slice((page - 1) * pageSize, page * pageSize),
          total: items.length,
          page,
          page_size: pageSize,
        },
      })
    }
    const usage = parsed.pathname.match(/^\/api\/channel\/(\d+)\/codex\/usage$/)
    if (usage) {
      if (usage[1] === "9") {
        return jsonResponse({ success: false, message: "upstream status: 401", data: {} })
      }
      return jsonResponse({ success: true, message: "", upstream_status: 200, data: codexUsage() })
    }
    return jsonResponse({ success: false, message: "not found" }, 404)
  }
}

test("NewAPI 使用 Bearer 访问令牌分页读取渠道，并过滤不支持额度的渠道", async () => {
  const requests = []
  const many = Array.from({ length: 150 }, (_, index) => ({
    id: index + 1,
    type: index % 2 ? 57 : 24,
    name: `渠道 ${index + 1}`,
    status: 1,
  }))
  const result = await listNewapiQuotaChannels(config, createNewapiFetch(requests, many))

  assert.equal(result.length, 75)
  assert.deepEqual(
    requests.map(request => request.url.searchParams.get("p")),
    ["1", "2"],
  )
  assert.equal(requests[0].url.searchParams.get("page_size"), "100")
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret")
})

test("NewAPI 查询 Codex 额度窗口与已缓存余额，隐藏无额度或失败的渠道", async () => {
  const requests = []
  const results = await queryNewapiQuota(config, "Asia/Shanghai", [], createNewapiFetch(requests))

  assert.deepEqual(
    results.map(result => [result.account.id, result.platform]),
    [
      [1, "codex"],
      [2, "codex"],
      [5, "deepseek"],
      [7, "siliconflow"],
    ],
  )
  const usagePaths = requests
    .map(request => request.url.pathname)
    .filter(path => path.endsWith("/codex/usage"))
  assert.deepEqual(usagePaths, [
    "/api/channel/1/codex/usage",
    "/api/channel/2/codex/usage",
    "/api/channel/9/codex/usage",
  ])
  assert.ok(requests.every(request => !request.url.pathname.includes("update_balance")))

  const codex = results[0]
  assert.deepEqual(
    {
      source: codex.source,
      label: codex.label,
      plan: codex.plan,
      account: codex.account,
    },
    {
      source: "newapi",
      label: "Codex",
      plan: "plus",
      account: { id: 1, name: "Codex 主力", platform: "codex", type: "oauth", source: "newapi" },
    },
  )
  assert.deepEqual(
    codex.windows.map(window => [window.label, window.usedPercent]),
    [
      ["Codex 5 小时", 25],
      ["Codex 每周", 60],
    ],
  )
  assert.equal(codex.windows[0].resetAt.toISOString(), "2030-01-01T00:00:00.000Z")

  assert.deepEqual(results[2].windows[0], {
    label: "余额 USD",
    usedPercent: null,
    balance: 3.5,
    currency: "USD",
    available: true,
    detail: "更新于 08/14 12:00",
    resetAt: null,
  })
  assert.equal(results[2].account.type, "apikey")
  assert.equal(results[3].windows[0].currency, "CNY")
})

test("NewAPI 只查询选中的渠道", async () => {
  const requests = []
  const results = await queryNewapiQuota(config, "Asia/Shanghai", [5], createNewapiFetch(requests))

  assert.deepEqual(
    results.map(result => result.account.id),
    [5],
  )
  assert.ok(requests.every(request => !request.url.pathname.endsWith("/codex/usage")))
})

test("NewAPI 锅巴告警选项只包含有剩余百分比的渠道", async () => {
  const options = await listNewapiQuotaAccountOptions(config, createNewapiFetch())
  assert.deepEqual(options, [
    { label: "NewAPI · Codex · Codex 主力", value: "newapi:codex:1" },
    { label: "NewAPI · Codex · Codex 自动禁用", value: "newapi:codex:2" },
  ])
})

test("NewAPI 渠道列表返回业务错误时抛出服务端消息", async () => {
  await assert.rejects(
    listNewapiQuotaChannels(config, async () =>
      jsonResponse({ success: false, message: "无权进行此操作，权限不足" }),
    ),
    /权限不足/,
  )
  await assert.rejects(
    listNewapiQuotaChannels({ ...config, accessToken: "" }),
    /NewAPI 尚未配置 baseUrl 或 accessToken/,
  )
})

const codingPlanChannels = [
  { id: 21, type: 25, name: "Kimi Coding", status: 1, base_url: "kimi-coding-plan" },
  { id: 22, type: 14, name: "Kimi Anthropic", status: 1, base_url: "https://api.kimi.com/coding" },
  { id: 23, type: 26, name: "GLM 国内", status: 1, base_url: "glm-coding-plan" },
  {
    id: 24,
    type: 26,
    name: "GLM 国际",
    status: 1,
    base_url: "https://api.z.ai/api/coding/paas/v4",
    channel_info: { is_multi_key: true },
  },
  { id: 25, type: 26, name: "GLM 未配置 Key", status: 1, base_url: "glm-coding-plan" },
  {
    id: 26,
    type: 25,
    name: "Moonshot 余额",
    status: 1,
    balance: 2,
    balance_updated_time: 1786680000,
  },
  { id: 1, type: 57, name: "Codex 主力", status: 1 },
]

const codingPlanConfig = {
  ...config,
  channels: [
    { channelId: 21, enabled: true, apiKey: "kimi-key" },
    { channelId: 22, enabled: false, apiKey: "kimi-key-2" },
    { channelId: 23, enabled: true, apiKey: "glm-key" },
    { channelId: 24, enabled: true, apiKey: "zai-key" },
    { channelId: 25, enabled: true, apiKey: "" },
    { channelId: 1, enabled: false, apiKey: "" },
  ],
}

function kimiUsage() {
  return {
    usage: { limit: "100", used: "40", remaining: "60", resetTime: "2026-08-20T00:00:00Z" },
    limits: [
      {
        window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        detail: { limit: "100", remaining: "90", resetTime: "2026-08-14T09:00:00Z" },
      },
    ],
  }
}

function glmUsage() {
  return {
    code: 200,
    success: true,
    data: {
      level: "pro",
      limits: [
        { type: "TIME_LIMIT", unit: 5, percentage: 1, nextResetTime: 1788000000000 },
        { type: "TOKENS_LIMIT", unit: 6, percentage: 30, nextResetTime: 1786700000000 },
        { type: "TOKENS_LIMIT", unit: 3, percentage: 12, nextResetTime: 1786710000000 },
      ],
    },
  }
}

function createCodingPlanFetch(requests = []) {
  const newapiFetch = createNewapiFetch([], codingPlanChannels)
  return async (url, options) => {
    const parsed = new URL(url)
    requests.push({ url: parsed, options })
    if (parsed.hostname === "api.kimi.com") return jsonResponse(kimiUsage())
    if (parsed.hostname === "open.bigmodel.cn") return jsonResponse(glmUsage())
    if (parsed.hostname === "api.z.ai") {
      return jsonResponse({ code: 1001, success: false, msg: "当前用户不存在coding plan" })
    }
    return newapiFetch(url, options)
  }
}

test("NewAPI 按 base_url 识别 Kimi / GLM Coding Plan 渠道", async () => {
  const options = await listNewapiChannelOptions(codingPlanConfig, createCodingPlanFetch())
  assert.deepEqual(options, [
    { label: "Kimi · Kimi Coding（#21）", value: 21 },
    { label: "Kimi · Kimi Anthropic（#22）", value: 22 },
    { label: "GLM · GLM 国内（#23）", value: 23 },
    { label: "GLM · GLM 国际（#24）", value: 24 },
    { label: "GLM · GLM 未配置 Key（#25）", value: 25 },
    { label: "Moonshot · Moonshot 余额（#26）", value: 26 },
    { label: "Codex · Codex 主力（#1）", value: 1 },
  ])
})

test("NewAPI Kimi / GLM 使用渠道配置的 Key 直连上游，未配置 Key 或关闭显示的渠道不展示", async () => {
  const requests = []
  const results = await queryNewapiQuota(
    codingPlanConfig,
    "Asia/Shanghai",
    [],
    createCodingPlanFetch(requests),
    { respectDisplay: true },
  )

  assert.deepEqual(
    results.map(result => [result.account.id, result.platform]),
    [
      [21, "kimi"],
      [23, "glm"],
      [26, "moonshot"],
    ],
  )

  const upstream = requests.filter(request => request.url.hostname !== "newapi.example.com")
  assert.deepEqual(
    upstream.map(request => [request.url.href, request.options.headers.Authorization]),
    [
      ["https://api.kimi.com/coding/v1/usages", "Bearer kimi-key"],
      ["https://open.bigmodel.cn/api/monitor/usage/quota/limit", "glm-key"],
      ["https://api.z.ai/api/monitor/usage/quota/limit", "zai-key"],
    ],
  )
  assert.ok(requests.every(request => !request.url.pathname.includes("/channel/1/codex")))

  const kimi = results[0]
  assert.equal(kimi.label, "Kimi")
  assert.equal(kimi.account.type, "apikey")
  assert.deepEqual(
    kimi.windows.map(window => [window.label, window.usedPercent]),
    [
      ["5 小时", 10],
      ["每周额度", 40],
    ],
  )

  const glm = results[1]
  assert.equal(glm.label, "GLM")
  assert.equal(glm.plan, "pro")
  assert.deepEqual(
    glm.windows.map(window => [window.label, window.usedPercent, window.resetAt.getTime()]),
    [
      ["5 小时", 12, 1786710000000],
      ["每周", 30, 1786700000000],
    ],
  )
})

test("NewAPI 告警与告警选项不受显示开关影响", async () => {
  const results = await queryNewapiQuota(
    codingPlanConfig,
    "Asia/Shanghai",
    [22, 1],
    createCodingPlanFetch(),
  )
  assert.deepEqual(
    results.map(result => result.account.id),
    [22, 1],
  )

  const options = await listNewapiQuotaAccountOptions(codingPlanConfig, createCodingPlanFetch())
  assert.deepEqual(
    options.map(option => option.value),
    ["newapi:kimi:21", "newapi:kimi:22", "newapi:glm:23", "newapi:codex:1"],
  )
})

test("NewAPI DeepSeek 配置 Key 后直连官方接口按原始币种显示，未配置时沿用 NewAPI 缓存余额", async () => {
  const items = [
    {
      id: 5,
      type: 43,
      name: "DeepSeek 直连",
      status: 1,
      balance: 1.5,
      balance_updated_time: 1786680000,
    },
    {
      id: 6,
      type: 43,
      name: "DeepSeek 缓存",
      status: 1,
      balance: 3.5,
      balance_updated_time: 1786680000,
    },
    {
      id: 7,
      type: 43,
      name: "DeepSeek Key 失效",
      status: 1,
      balance: 2,
      balance_updated_time: 1786680000,
    },
  ]
  const deepseekConfig = {
    ...config,
    channels: [
      { channelId: 5, enabled: true, apiKey: "ds-key" },
      { channelId: 7, enabled: true, apiKey: "bad-key" },
    ],
  }
  const requests = []
  const newapiFetch = createNewapiFetch([], items)
  const results = await queryNewapiQuota(
    deepseekConfig,
    "Asia/Shanghai",
    [],
    async (url, options) => {
      const parsed = new URL(url)
      if (parsed.hostname === "api.deepseek.com") {
        requests.push([parsed.href, options.headers.Authorization])
        if (options.headers.Authorization === "Bearer bad-key") {
          return jsonResponse({ error: { message: "Authentication Fails" } }, 401)
        }
        return jsonResponse({
          is_available: true,
          balance_infos: [
            {
              currency: "CNY",
              total_balance: "110.00",
              granted_balance: "10.00",
              topped_up_balance: "100.00",
            },
          ],
        })
      }
      return newapiFetch(url, options)
    },
  )

  assert.deepEqual(requests, [
    ["https://api.deepseek.com/user/balance", "Bearer ds-key"],
    ["https://api.deepseek.com/user/balance", "Bearer bad-key"],
  ])
  assert.deepEqual(
    results.map(result => [result.account.id, result.windows[0].label, result.windows[0].balance]),
    [
      [5, "余额 CNY", 110],
      [6, "余额 USD", 3.5],
    ],
  )
  assert.deepEqual(results[0].windows[0], {
    label: "余额 CNY",
    usedPercent: null,
    balance: 110,
    currency: "CNY",
    available: true,
    detail: "充值 100｜赠送 10",
    resetAt: null,
  })
})
