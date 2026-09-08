import assert from "node:assert/strict"
import test from "node:test"
import { addS2aUserBalance, getS2aUser, parsePositiveAmount } from "../lib/s2a-balance.js"

const config = {
  baseUrl: "https://s2a.example.com",
  adminApiKey: "secret",
  timeoutMs: 10000,
}

test("S2A 用户查询和增加余额使用管理接口", async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options })
    return new Response(JSON.stringify({ code: 0, data: { id: 7, username: "user" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  await getS2aUser(config, 7, fetchImpl)
  await addS2aUserBalance(config, 7, 12.5, "申请 BR-1", fetchImpl, "BR-1")
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/admin/users/7")
  assert.equal(new URL(requests[1].url).pathname, "/api/v1/admin/users/7/balance")
  assert.equal(requests[1].options.headers["x-api-key"], "secret")
  assert.equal(requests[1].options.headers["Idempotency-Key"], "BR-1")
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    balance: 12.5,
    operation: "add",
    notes: "申请 BR-1",
  })
})

test("余额金额必须为正数并保留两位小数", () => {
  assert.equal(parsePositiveAmount("1.239"), 1.24)
  assert.throws(() => parsePositiveAmount("0"), /大于 0/)
  assert.throws(() => parsePositiveAmount("not-a-number"), /大于 0/)
})
