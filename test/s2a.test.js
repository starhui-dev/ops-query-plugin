import assert from "node:assert/strict"
import test from "node:test"
import {
  buildS2aImageData,
  formatS2aForwardNodes,
  formatS2aMonitor,
  formatS2aReport,
  formatS2aSummary,
  getLatestPingLatency,
  getRecentChecks,
} from "../lib/s2a.js"

const FIXED_NOW = Date.parse("2026-08-08T04:30:00Z")

test("汇总 S2A 渠道监控状态", () => {
  const text = formatS2aSummary([
    { enabled: true, primary_status: "operational" },
    { enabled: true, primary_status: "operational" },
    { enabled: true, primary_status: "degraded" },
    { enabled: true, primary_status: "failed" },
    { enabled: false, primary_status: "operational" },
  ])
  assert.equal(text, "S2A 渠道监控\n共 5 个｜正常 2｜降级 1｜异常 1｜停用 1｜未知 0")
})

test("从最新历史记录读取端点 Ping", () => {
  assert.equal(getLatestPingLatency({ data: { items: [{ ping_latency_ms: 28 }] } }), 28)
  assert.equal(getLatestPingLatency({ data: { items: [{ ping_latency_ms: null }] } }), null)
  assert.equal(getLatestPingLatency({ data: { items: [] } }), null)
})

test("监控历史按过去到现在排列", () => {
  const checks = getRecentChecks({
    data: {
      items: [
        { status: "operational", checked_at: "2026-08-08T04:30:00Z" },
        { status: "failed", checked_at: "2026-08-08T04:29:00Z" },
      ],
    },
  })
  assert.deepEqual(
    checks.map(item => item.status),
    ["failed", "operational"],
  )
})

test("格式化 S2A 监控明细", () => {
  const text = formatS2aMonitor(
    {
      id: 1,
      name: "OpenAI",
      provider: "openai",
      primary_model: "gpt-5.6-luna",
      enabled: true,
      primary_status: "degraded",
      primary_latency_ms: 6246,
      primary_ping_latency_ms: 33,
      availability_7d: 99.4847,
      last_checked_at: "2026-08-06T09:43:11Z",
    },
    "Asia/Shanghai",
  )
  assert.match(text, /^OpenAI · 降级/m)
  assert.doesNotMatch(text, /```|^#{1,6}\s|\*\*/m)
  assert.match(text, /提供商  OpenAI/)
  assert.match(text, /模型      gpt-5\.6-luna/)
  assert.match(text, /对话延迟  6246ms/)
  assert.match(text, /端点 Ping 33ms/)
  assert.match(text, /7天可用率 99\.48%/)
  assert.match(text, /最后检测  08\/06 17:43:11/)
})

test("所有渠道合并为一条纯文本报告", () => {
  const monitors = [
    {
      id: 1,
      name: "OpenAI",
      provider: "openai",
      primary_model: "gpt-5",
      enabled: true,
      primary_status: "operational",
    },
    {
      id: 2,
      name: "Gemini",
      provider: "gemini",
      primary_model: "gemini-2.5-pro",
      enabled: true,
      primary_status: "degraded",
    },
  ]
  const text = formatS2aReport(monitors)
  assert.equal(text.match(/S2A 渠道监控/g)?.length, 1)
  assert.doesNotMatch(text, /```|^#{1,6}\s|\*\*/m)
  assert.match(text, /^OpenAI · 正常/m)
  assert.match(text, /^Gemini · 降级/m)
})

test("合并转发包含一个汇总节点和每个渠道的独立节点", () => {
  const monitors = [
    {
      id: 1,
      name: "OpenAI",
      provider: "openai",
      primary_model: "gpt-5",
      enabled: true,
      primary_status: "operational",
    },
    {
      id: 2,
      name: "Gemini",
      provider: "gemini",
      primary_model: "gemini-2.5-pro",
      enabled: true,
      primary_status: "degraded",
    },
  ]

  const nodes = formatS2aForwardNodes(monitors)
  assert.equal(nodes.length, 3)
  assert.match(nodes[0], /^S2A 渠道监控/m)
  assert.match(nodes[1], /^OpenAI · 正常/m)
  assert.match(nodes[2], /^Gemini · 降级/m)
})

test("构建包含所有渠道的状态图片数据", () => {
  const data = buildS2aImageData(
    [
      {
        id: 1,
        name: "OpenAI",
        provider: "openai",
        primary_model: "gpt-5.6-luna",
        enabled: true,
        primary_status: "operational",
        primary_latency_ms: 860,
        primary_ping_latency_ms: 31,
        availability_7d: 99.88,
        last_checked_at: "2026-08-08T04:29:00Z",
        recent_checks: [
          { status: "failed", checked_at: "2026-08-08T04:28:00Z" },
          { status: "operational", checked_at: "2026-08-08T04:29:00Z" },
        ],
      },
      {
        id: 2,
        name: "Kimi",
        provider: "kimi",
        primary_model: "kimi-k2",
        enabled: true,
        primary_status: "degraded",
        availability_7d: 91.2,
      },
    ],
    "Asia/Shanghai",
    FIXED_NOW,
  )

  assert.equal(data.title, "渠道状态")
  assert.equal(data.periodLabel, "最近 60 次检测")
  assert.equal(data.channels.length, 2)
  assert.equal(data.channels[0].badge, "正常")
  assert.equal(data.channels[0].availability, "99.88%")
  assert.deepEqual(
    data.channels[0].checks.map(item => item.tone),
    ["danger", "success"],
  )
  assert.equal(data.channels[1].badge, "降级")
})
