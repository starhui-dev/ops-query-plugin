import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  bindAccount,
  createBalanceRequest,
  createBindingRequest,
  emptyBalanceRequestState,
  findRequest,
  getBinding,
  loadBalanceRequestState,
  markRequestApproved,
  markRequestRejected,
  saveBalanceRequestState,
} from "../lib/balance-requests.js"

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-query-balance-"))
  return path.join(dir, "state.json")
}

test("余额申请状态可以持久化绑定、申请和审批结果", () => {
  const file = tempFile()
  const state = emptyBalanceRequestState()
  bindAccount(state, {
    groupId: "100",
    userId: "200",
    accountId: 7,
    email: "user@example.com",
    approvedBy: "admin",
  })
  const request = createBalanceRequest(state, {
    groupId: "100",
    userId: "200",
    accountId: 7,
    email: "user@example.com",
    amount: 12.5,
    applicantName: "测试用户",
    sourceMessageId: "message-0",
  })
  saveBalanceRequestState(state, file)

  const loaded = loadBalanceRequestState(file)
  assert.equal(getBinding(loaded, "100", "200").accountId, 7)
  assert.equal(findRequest(loaded, { requestId: request.id, groupId: "100" }).amount, 12.5)
  assert.equal(findRequest(loaded, { messageId: "message-0", groupId: "100" }).id, request.id)
  markRequestApproved(loaded, request.id, "admin")
  saveBalanceRequestState(loaded, file)
  assert.equal(loadBalanceRequestState(file).requests[0].status, "approved")
})

test("申请编号可以通过申请消息 ID 定位，拒绝会保存理由", () => {
  const state = emptyBalanceRequestState()
  const request = createBindingRequest(state, {
    groupId: "100",
    userId: "200",
    accountId: 8,
    email: "other@example.com",
    applicantName: "测试用户",
  })
  request.messageId = "message-1"
  const found = findRequest(state, { messageId: "message-1", groupId: "100" })
  assert.equal(found.id, request.id)
  markRequestRejected(state, request.id, "admin", "账号不匹配")
  assert.equal(request.status, "rejected")
  assert.equal(request.reason, "账号不匹配")
})
