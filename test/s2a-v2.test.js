import assert from "node:assert/strict"
import test from "node:test"
import { buildS2aV2ImageData, formatS2aV2ForwardNodes, queryS2aV2Monitor } from "../lib/s2a-v2.js"

const FIXED_NOW = Date.parse("2026-08-13T11:38:00Z")

function metric(overrides = {}) {
  return {
    request_count: 10,
    error_rate: 0.02,
    cache_rate: 0.923,
    rpm: 0.4,
    tpm: 14316,
    ttft: { sample_count: 8, p50_ms: 500, p90_ms: 10000, avg_ms: 4000 },
    ...overrides,
  }
}

function health(overrides = {}) {
  return {
    overall: "healthy",
    error_rate: "healthy",
    ttft: "warning",
    cache: "healthy",
    score: 92,
    ...overrides,
  }
}

const coverage = {
  requested_start: "2026-08-13T10:05:00Z",
  requested_end: "2026-08-13T11:40:00Z",
  coverage_start: "2026-08-13T10:05:00Z",
  data_through: "2026-08-13T11:35:00Z",
  computed_at: "2026-08-13T11:36:00Z",
  aggregation_lag_seconds: 60,
  coverage_complete: true,
  bucket_seconds: 300,
}

test("构建 Sub2API V2 监控图片数据", () => {
  const data = buildS2aV2ImageData(
    {
      range: "90m",
      snapshot: {
        coverage,
        metrics: metric(),
        health: health(),
        trend: [],
      },
      matrix: {
        coverage,
        group_by: "platform_group",
        items: [
          {
            platform: "openai",
            group_id: 2,
            group_name: "DeepSeek",
            metrics: metric({ tpm: 5000, cache_rate: 0.84 }),
            health: health({ score: 84 }),
            buckets: [
              {
                bucket_start: "2026-08-13T10:05:00Z",
                metrics: metric(),
                health: health({ score: 30, overall: "critical" }),
              },
              {
                bucket_start: "2026-08-13T11:35:00Z",
                metrics: metric(),
                health: health({ score: 96 }),
              },
            ],
          },
        ],
      },
      models: {
        coverage,
        items: [
          {
            platform: "openai",
            model: "gpt-5.6-sol",
            metrics: metric({ tpm: 9252, cache_rate: 0.974, rpm: 0.1 }),
            health: health({ score: 97 }),
          },
        ],
      },
    },
    "Asia/Shanghai",
    FIXED_NOW,
  )

  assert.equal(data.title, "渠道状态 V2")
  assert.equal(data.rangeLabel, "最近 90 分钟")
  assert.equal(data.summary.successRate, "98.0%")
  assert.equal(data.summary.ttft, "500ms")
  assert.equal(data.summary.tps, "238.6")
  assert.equal(data.summary.cacheRate, "92.3%")
  assert.equal(data.summary.rpm, "0.4")
  assert.equal(data.matrixRows[0].label, "openai / DeepSeek")
  assert.equal(data.matrixRows[0].buckets.length, 19)
  assert.equal(data.matrixRows[0].buckets[0].tone, "danger")
  assert.equal(data.matrixRows[0].buckets[1].tone, "muted")
  assert.equal(data.matrixRows[0].buckets.at(-1).tone, "success")
  assert.equal(data.models[0].model, "gpt-5.6-sol")
  assert.equal(data.models[0].tps, "154.2")
})

test("V2 缺少采样时使用稳定占位而不是 NaN", () => {
  const data = buildS2aV2ImageData({
    range: "90m",
    snapshot: { coverage: {}, metrics: {}, health: {}, trend: [] },
    matrix: { coverage: {}, items: [] },
    models: { coverage: {}, items: [] },
  })

  assert.equal(data.summary.successRate, "-")
  assert.equal(data.summary.ttft, "-")
  assert.equal(data.summary.tps, "-")
  assert.equal(data.summary.cacheRate, "-")
  assert.equal(data.summary.rpm, "-")
  assert.equal(data.updatedAt, "未知")
})

test("V2 纯文本降级报告包含总览和模型排行", () => {
  const nodes = formatS2aV2ForwardNodes({
    range: "90m",
    snapshot: { coverage, metrics: metric(), health: health() },
    matrix: { coverage, items: [] },
    models: {
      coverage,
      items: [
        {
          platform: "openai",
          model: "gpt-5.6-sol",
          metrics: metric({ tpm: 9252 }),
          health: health(),
        },
      ],
    },
  })

  assert.equal(nodes.length, 2)
  assert.match(nodes[0], /^S2A 渠道监控 V2/m)
  assert.match(nodes[0], /成功率 98\.0%｜首 Token P50 500ms｜每秒 Token 238\.6/)
  assert.match(nodes[1], /^openai · gpt-5\.6-sol/m)
})

test("V2 查询使用官方管理端接口", async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options })
    const pathname = new URL(url).pathname
    const data = pathname.endsWith("/snapshot")
      ? { coverage, metrics: metric(), health: health(), trend: [] }
      : { coverage, items: [] }
    return new Response(JSON.stringify({ code: 0, message: "success", data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const result = await queryS2aV2Monitor({
      baseUrl: "https://s2a.example.com",
      adminApiKey: "secret",
      timeoutMs: 10000,
      range: "90m",
    })
    assert.equal(result.range, "90m")
    assert.equal(requests.length, 3)
    assert.ok(requests.some(item => item.url.includes("/api/v1/admin/channel-monitor-v2/snapshot")))
    const matrixRequest = requests.find(item => item.url.includes("/matrix?"))
    assert.equal(new URL(matrixRequest.url).searchParams.get("group_by"), "platform_group")
    assert.equal(new URL(matrixRequest.url).searchParams.get("range"), "90m")
    assert.ok(requests.every(item => item.options.headers["x-api-key"] === "secret"))
  } finally {
    globalThis.fetch = originalFetch
  }
})
