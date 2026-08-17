import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  evaluateCodexResetNotification,
  formatCodexResetNotification,
  formatCodexResetStatus,
  loadCodexResetState,
  parseCodexResetStatus,
  queryCodexResetStatus,
  saveCodexResetState,
} from "../lib/codex-resets.js"

function apiResponse(overrides = {}) {
  return {
    data: {
      latest_reset: {
        id: "2087706104814023111",
        announced_at: "2026-08-13T01:01:37.000Z",
        text: "Codex usage limits have been reset.",
        source: {
          type: "x_post",
          author: "thsottiaux",
          url: "https://x.com/thsottiaux/status/2087706104814023111",
        },
      },
      active_watch: null,
      stats: { total: 43 },
      ...overrides,
    },
  }
}

test("解析 Codex Resets 状态并格式化手动查询结果", () => {
  const status = parseCodexResetStatus(apiResponse())
  const text = formatCodexResetStatus(status, "Asia/Shanghai")

  assert.equal(status.latestReset.id, "2087706104814023111")
  assert.match(text, /^Codex 重置动态/m)
  assert.match(text, /最近重置  2026\/08\/13 09:01/)
  assert.match(text, /累计记录  43 次/)
  assert.match(text, /Codex usage limits have been reset\./)
  assert.match(text, /当前没有活跃预测/)
  assert.match(text, /https:\/\/x\.com\/thsottiaux\/status\/2087706104814023111/)
})

test("手动查询明确标记 AI 重置预测", () => {
  const status = parseCodexResetStatus(
    apiResponse({
      active_watch: {
        level: "strong",
        reset_chance_percent: 80,
        forecast_window: "next 24 hours",
        observed_at: "2026-08-16T00:00:00Z",
        expires_at: "2026-08-17T00:00:00Z",
        text: "A reset may be announced soon.",
        source: {
          type: "x_post",
          author: "thsottiaux",
          url: "https://x.com/thsottiaux/status/2089000000000000000",
        },
      },
    }),
  )

  const text = formatCodexResetStatus(status, "Asia/Shanghai")
  assert.match(text, /重置观察（AI 预测，非官方承诺）/)
  assert.match(text, /级别      强烈/)
  assert.match(text, /重置概率  80%/)
  assert.match(text, /预测窗口  next 24 hours/)
})

test("首次检查只建立基线，之后只通知更大的 Post ID", () => {
  const status = parseCodexResetStatus(apiResponse())

  assert.deepEqual(evaluateCodexResetNotification(status, null), {
    latestResetId: "2087706104814023111",
    notification: null,
  })
  assert.equal(evaluateCodexResetNotification(status, "2087706104814023111").notification, null)
  assert.equal(
    evaluateCodexResetNotification(status, "2087706104814023000").notification.id,
    "2087706104814023111",
  )
  assert.deepEqual(evaluateCodexResetNotification(status, "2087706104814024000"), {
    latestResetId: "2087706104814024000",
    notification: null,
  })
})

test("格式化 Codex 重置订阅通知", () => {
  const reset = parseCodexResetStatus(apiResponse()).latestReset
  const text = formatCodexResetNotification(reset, "Asia/Shanghai")

  assert.match(text, /^Codex 额度重置通知/m)
  assert.match(text, /公告时间  2026\/08\/13 09:01/)
  assert.match(text, /来源：@thsottiaux/)
})

test("持久化最后处理的 Codex 重置 Post ID", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ops-query-codex-resets-"))
  const file = path.join(directory, "state.json")
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  assert.deepEqual(loadCodexResetState(file), { latestResetId: null })
  saveCodexResetState("2087706104814023111", file)
  assert.deepEqual(loadCodexResetState(file), { latestResetId: "2087706104814023111" })
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test("直连请求 Codex Resets 公共状态接口", async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options }
    return new Response(JSON.stringify(apiResponse()), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const status = await queryCodexResetStatus(
    { enabled: false, url: "http://127.0.0.1:7890" },
    fetchImpl,
  )
  assert.equal(request.url, "https://codex-resets.com/api/v1/status")
  assert.equal(request.options.headers["User-Agent"], "ops-query-plugin/0.1")
  assert.equal(request.options.dispatcher, undefined)
  assert.equal(status.stats.total, 43)
})

test("通过配置的 HTTP 代理请求 Codex Resets", async () => {
  let dispatcherName
  const fetchImpl = async (_url, options) => {
    dispatcherName = options.dispatcher?.constructor.name
    return new Response(JSON.stringify(apiResponse()), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const status = await queryCodexResetStatus(
    { enabled: true, url: "http://127.0.0.1:7890" },
    fetchImpl,
  )
  assert.equal(dispatcherName, "ProxyAgent")
  assert.equal(status.stats.total, 43)
})

test("拒绝异常的 Codex Resets 响应", () => {
  assert.throws(
    () => parseCodexResetStatus(apiResponse({ latest_reset: { id: "not-a-post-id" } })),
    /响应结构异常/,
  )
})
