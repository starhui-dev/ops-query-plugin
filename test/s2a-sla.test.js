import assert from "node:assert/strict"
import test from "node:test"
import {
  buildS2aSlaAlertImageData,
  evaluateS2aSlaAlert,
  formatS2aSlaAlert,
  queryS2aSla,
} from "../lib/s2a-sla.js"

function overview(overrides = {}) {
  return {
    start_time: "2026-08-13T10:00:00Z",
    end_time: "2026-08-13T11:00:00Z",
    success_count: 995,
    error_count_total: 10,
    business_limited_count: 5,
    error_count_sla: 5,
    request_count_total: 1005,
    request_count_sla: 1000,
    sla: 0.995,
    ...overrides,
  }
}

const rule = { enabled: true, thresholdPercent: 99.9, timeRange: "1h" }

test("S2A SLA 低于阈值只告警一次，恢复后允许再次告警", () => {
  const states = new Map()

  const first = evaluateS2aSlaAlert(rule, overview(), states)
  assert.equal(first.slaPercent, 99.5)
  assert.equal(first.exceptionCount, 5)
  assert.equal(evaluateS2aSlaAlert(rule, overview(), states), null)
  assert.equal(evaluateS2aSlaAlert(rule, overview({ sla: 1, error_count_sla: 0 }), states), null)
  assert.ok(evaluateS2aSlaAlert(rule, overview(), states))
})

test("S2A SLA 无统计样本时不告警且不改变已有状态", () => {
  const states = new Map([["s2a:sla", "low"]])
  assert.equal(
    evaluateS2aSlaAlert(
      rule,
      overview({ request_count_sla: 0, success_count: 0, error_count_sla: 0, sla: 0 }),
      states,
    ),
    null,
  )
  assert.equal(states.get("s2a:sla"), "low")
})

test("格式化 S2A SLA 告警及图片数据", () => {
  const alert = evaluateS2aSlaAlert(rule, overview())
  const text = formatS2aSlaAlert(alert)
  assert.match(text, /^Sub2API SLA 告警/m)
  assert.match(text, /当前 SLA  99\.500%/)
  assert.match(text, /异常数    5/)
  assert.match(text, /业务限制  5（已排除）/)

  const data = buildS2aSlaAlertImageData(alert, "Asia/Shanghai", Date.parse("2026-08-13T11:05:00Z"))
  assert.equal(data.title, "Sub2API SLA 告警")
  assert.equal(data.sla, "99.500%")
  assert.equal(data.threshold, "99.900%")
  assert.equal(data.exceptionCount, "5")
  assert.equal(data.businessLimitedCount, "5")
  assert.equal(data.requestCount, "1000")
  assert.equal(data.progress, 99.5)
  assert.equal(data.timeRange, "近 1 小时")
})

test("S2A SLA 查询使用官方 Ops 概览接口", async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return new Response(
      JSON.stringify({ code: 0, message: "success", data: overview({ sla: 1 }) }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  try {
    const result = await queryS2aSla(
      {
        baseUrl: "https://s2a.example.com",
        adminApiKey: "secret",
        timeoutMs: 10000,
      },
      "6h",
    )
    const url = new URL(request.url)
    assert.equal(url.pathname, "/api/v1/admin/ops/dashboard/overview")
    assert.equal(url.searchParams.get("time_range"), "6h")
    assert.equal(request.options.headers["x-api-key"], "secret")
    assert.equal(result.sla, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
