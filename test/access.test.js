import assert from "node:assert/strict"
import test from "node:test"
import { checkQueryAccess } from "../lib/access.js"

const access = { groupWhitelist: ["10001"], queryUsers: ["20001"] }

test("主人绕过查询人员和群白名单限制", () => {
  assert.deepEqual(checkQueryAccess({ isMaster: true, user_id: 1, group_id: 2 }, access), {
    allowed: true,
  })
})

test("普通用户同时受查询人员和群白名单限制", () => {
  assert.equal(checkQueryAccess({ user_id: 20002, group_id: 10001 }, access).allowed, false)
  assert.equal(checkQueryAccess({ user_id: 20001, group_id: 10002 }, access).allowed, false)
  assert.equal(checkQueryAccess({ user_id: 20001, group_id: 10001 }, access).allowed, true)
  assert.equal(checkQueryAccess({ user_id: 20001 }, access).allowed, true)
})
