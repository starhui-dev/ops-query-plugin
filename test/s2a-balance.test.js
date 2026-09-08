import assert from "node:assert/strict"
import test from "node:test"
import {
  addS2aUserBalance,
  assertBalanceRequestEligible,
  getS2aUser,
  getS2aUserByEmail,
  parsePositiveAmount,
} from "../lib/s2a-balance.js"

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

test("可以用邮箱精确查询 S2A 用户", async () => {
  const requests = []
  const user = await getS2aUserByEmail(config, "User@Example.com", async (url, options) => {
    requests.push({ url: String(url), options })
    return new Response(
      JSON.stringify({
        code: 0,
        data: { items: [{ id: 7, email: "user@example.com", username: "user" }] },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })
  const parsed = new URL(requests[0].url)
  assert.equal(parsed.pathname, "/api/v1/admin/users")
  assert.equal(parsed.searchParams.get("search"), "user@example.com")
  assert.equal(user.id, 7)
  assert.equal(user.email, "user@example.com")
})

test("邮箱查询不会接受模糊匹配到的其他邮箱", async () => {
  await assert.rejects(
    () =>
      getS2aUserByEmail(
        config,
        "user@example.com",
        async () =>
          new Response(
            JSON.stringify({
              code: 0,
              data: { items: [{ id: 7, email: "user2@example.com" }] },
            }),
            { status: 200 },
          ),
      ),
    /没有找到该邮箱/,
  )
})

test("余额金额必须为正数并保留两位小数", () => {
  assert.equal(parsePositiveAmount("1.239"), 1.24)
  assert.throws(() => parsePositiveAmount("0"), /大于 0/)
  assert.throws(() => parsePositiveAmount("not-a-number"), /大于 0/)
})

test("当前余额大于 5 时不允许申请余额", () => {
  assert.equal(assertBalanceRequestEligible({ balance: 5 }), 5)
  assert.throws(() => assertBalanceRequestEligible({ balance: 5.01 }), /大于 5/)
  assert.throws(() => assertBalanceRequestEligible({}), /无法读取 S2A 当前余额/)
})
