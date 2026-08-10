import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCpaQuotaImageData,
  buildCpaStatusImageData,
  formatCpaQuota,
  formatCpaResult,
  formatCpaStatus,
  getCodexApiKeys,
  getCodexAuthFiles,
  getProviderAuthFiles,
  parseApiCallResult,
  summarizeRecentRequests,
} from "../lib/cpa.js"

const FIXED_NOW = Date.parse("2026-08-08T04:30:00Z")

test("只选择未停用的 Codex 凭据", () => {
  const files = getCodexAuthFiles({
    files: [
      { provider: "codex", name: "a" },
      { type: "Codex", name: "b", disabled: false },
      { provider: "codex", name: "c", disabled: true },
      { provider: "claude", name: "d" },
    ],
  })
  assert.deepEqual(
    files.map(item => item.name),
    ["a", "b"],
  )
})

test("汇总 CPA 内全部提供商的凭据状态", () => {
  const text = formatCpaStatus({
    files: [
      { provider: "codex", email: "user@example.com", status: "active", success: 20, failed: 1 },
      { provider: "codex", disabled: true },
      { provider: "claude", unavailable: true },
      { provider: "gemini", status: "active" },
    ],
    codexKeys: [
      {
        "api-key": "sk-status-test",
        "base-url": "https://relay.internal.example/v1",
      },
    ],
    apiKeyUsage: {},
  })
  assert.match(text, /^CPA 状态\n凭据 4 个｜API 渠道 1 个/m)
  assert.match(text, /Codex · u\.\.\.r@example\.com · 正常/)
  assert.doesNotMatch(text, /user@example\.com|relay\.internal\.example/)
  assert.match(text, /地址 已隐藏/)
  assert.match(text, /成功 20｜失败 1/)
  assert.match(text, /Claude · 未知账号 · 异常/)
})

test("读取 Codex API 渠道配置", () => {
  const keys = getCodexApiKeys({
    "codex-api-key": [{ "api-key": "sk-test-a", "base-url": "https://codex.example", models: [] }],
  })
  assert.equal(keys.length, 1)
  assert.equal(keys[0]["api-key"], "sk-test-a")
})

test("按最近时间桶计算健康率和活动段", () => {
  const active = summarizeRecentRequests([
    { time: "09:00-09:10", success: 20, failed: 0 },
    { time: "09:10-09:20", success: 9, failed: 1 },
    { time: "09:20-09:30", success: 0, failed: 0 },
  ])
  assert.equal(active.healthPercent, 96.7)
  assert.deepEqual(
    active.segments.map(item => item.tone),
    ["success", "warning", "idle"],
  )

  const idle = summarizeRecentRequests([{ time: "09:00-09:10", success: 0, failed: 0 }])
  assert.equal(idle.healthPercent, null)
})

test("构建包含凭据和 API 渠道明细的 CPA 状态图片数据", () => {
  const apiKey = "sk-1234567890abcdef"
  const data = buildCpaStatusImageData(
    {
      files: [
        {
          provider: "codex",
          email: "user@gmail.com",
          name: "codex-user@gmail.com-pro.json",
          auth_index: "auth-a",
          status: "active",
          success: 100,
          failed: 2,
          recent_requests: [
            { time: "09:00-09:10", success: 99, failed: 1 },
            { time: "09:10-09:20", success: 0, failed: 0 },
          ],
          size: 4250,
          modtime: "2026-08-10T01:40:00Z",
          priority: 100,
          weight: 1,
        },
        { provider: "kimi", unavailable: true },
      ],
      codexKeys: [
        {
          "api-key": apiKey,
          "auth-index": "api-auth-a",
          "base-url": "https://codex.example.com",
          priority: 50,
          weight: 2,
          models: [{ name: "gpt-5" }, { name: "gpt-5-mini" }],
          headers: { "X-Test": "secret" },
        },
      ],
      apiKeyUsage: {
        [`https://codex.example.com|${apiKey}`]: {
          success: 8,
          failed: 1,
          recent_requests: [{ time: "09:00-09:10", success: 0, failed: 1 }],
        },
      },
    },
    "Asia/Shanghai",
    FIXED_NOW,
  )

  assert.equal(data.title, "CPA 状态")
  assert.deepEqual(
    data.summary.map(item => item.value),
    ["2", "1", "1", "98%"],
  )
  assert.equal(data.sections.length, 3)
  assert.equal(data.sections[0].title, "u...r@gmail.com")
  assert.equal(data.sections[0].subtitle, "凭据文件已隐藏")
  assert.equal(data.sections[0].rows.find(row => row.label === "近 3 小时健康").progress, 99)
  assert.equal(data.sections[0].rows.find(row => row.label === "文件").value, "4.15 KB")
  assert.equal(data.sections[2].title, "sk-1******cdef")
  assert.equal(data.sections[2].subtitle, "服务地址已隐藏")
  assert.equal(data.sections[2].rows.find(row => row.label === "模型").value, "2")
  assert.equal(data.sections[2].rows.find(row => row.label === "请求头").value, "1")
  assert.equal(data.sections[2].rows.find(row => row.label === "近 3 小时健康").progress, 0)
  assert.equal(data.updatedAt, "08/08 12:30")
  const serialized = JSON.stringify(data)
  assert.doesNotMatch(
    serialized,
    /user@gmail\.com|codex-user@gmail\.com-pro\.json|codex\.example\.com/,
  )
})

test("解析 CPA api-call 的字符串响应", () => {
  assert.deepEqual(parseApiCallResult({ status_code: 200, body: '{"plan_type":"plus"}' }), {
    plan_type: "plus",
  })
})

test("只选择指定的 Codex 账号", () => {
  const files = getProviderAuthFiles(
    {
      files: [
        { provider: "codex", auth_index: "codex-a" },
        { type: "Codex", auth_index: "codex-b" },
        { provider: "codex", auth_index: "codex-c", disabled: true },
        { provider: "kimi", auth_index: "kimi-a" },
      ],
    },
    "codex",
    ["codex-b"],
  )
  assert.deepEqual(
    files.map(item => item.auth_index),
    ["codex-b"],
  )
})

test("格式化 Codex 剩余额度窗口", () => {
  const text = formatCpaResult({
    file: { email: "user@example.com" },
    timeZone: "Asia/Shanghai",
    quota: {
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 18000,
          reset_at: 1893456000,
        },
        secondary_window: {
          used_percent: 60,
          limit_window_seconds: 604800,
          reset_at: 1893456000,
        },
      },
    },
  })
  assert.match(text, /u\.\.\.r@example\.com（plus）/)
  assert.doesNotMatch(text, /user@example\.com/)
  assert.match(text, /Codex 5 小时：剩余 75%/)
  assert.match(text, /Codex 每周：剩余 40%/)
})

test("额度报告使用纯文本", () => {
  const text = formatCpaQuota([
    {
      provider: "codex",
      file: { email: "user@gmail.com" },
      timeZone: "Asia/Shanghai",
      quota: {
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 25, limit_window_seconds: 18000 },
        },
      },
    },
  ])
  assert.match(text, /^CPA Codex 额度/m)
  assert.match(text, /^Codex · u\.\.\.r@gmail\.com$/m)
  assert.doesNotMatch(text, /user@gmail\.com/)
  assert.doesNotMatch(text, /```|^#{1,6}\s|\*\*/m)
})

test("构建 Codex 订阅图片数据时隐藏账号", () => {
  const data = buildCpaQuotaImageData(
    [
      {
        provider: "codex",
        file: { email: "user@gmail.com" },
        timeZone: "Asia/Shanghai",
        quota: {
          plan_type: "plus",
          rate_limit: {
            primary_window: {
              used_percent: 25,
              limit_window_seconds: 18000,
              reset_at: 1893456000,
            },
          },
        },
      },
    ],
    "Asia/Shanghai",
    FIXED_NOW,
  )

  assert.equal(data.title, "Codex 订阅")
  assert.equal(data.sections[0].title, "u...r@gmail.com")
  assert.equal(data.sections[0].subtitle, "Codex 账号")
  assert.doesNotMatch(JSON.stringify(data), /user@gmail\.com/)
  assert.equal(data.sections[0].badge, "PLUS")
  assert.equal(data.sections[0].rows[0].progress, 75)
  assert.match(data.sections[0].rows[0].detail, /重置于/)
})

test("Codex 凭据失效时返回可操作提示", () => {
  assert.throws(
    () =>
      parseApiCallResult({
        status_code: 401,
        body: JSON.stringify({
          details: [{ debug: { reason: "REASON_INVALID_AUTH_TOKEN" } }],
        }),
      }),
    /凭据已失效.*重新登录/,
  )
})
