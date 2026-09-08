import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { parsePositiveAmount, parseS2aUserId } from "./s2a-balance.js"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const balanceRequestStatePath = path.join(pluginRoot, "data", "balance-requests.json")
export const BALANCE_REQUEST_STATE_VERSION = 1

export function emptyBalanceRequestState() {
  return { version: BALANCE_REQUEST_STATE_VERSION, bindings: {}, requests: [] }
}

export function loadBalanceRequestState(file = balanceRequestStatePath) {
  if (!fs.existsSync(file)) return emptyBalanceRequestState()
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")))
  } catch (error) {
    throw new Error(`余额申请状态读取失败：${error.message}`)
  }
}

export function saveBalanceRequestState(state, file = balanceRequestStatePath) {
  const normalized = normalizeState(state)
  const temporary = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o600)
  } catch (error) {
    throw new Error(`余额申请状态保存失败：${error.message}`)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

export function getBinding(state, groupId, userId) {
  return state.bindings[bindingKey(groupId, userId)] ?? null
}

export function findBindingByAccount(state, accountId) {
  const id = Number(accountId)
  return Object.values(state.bindings).find(binding => Number(binding?.accountId) === id) ?? null
}

export function bindAccount(state, { groupId, userId, accountId, approvedBy = "" }) {
  const binding = {
    groupId: normalizeId(groupId, "群号"),
    userId: normalizeId(userId, "QQ号"),
    accountId: parseS2aUserId(accountId),
    approvedBy: String(approvedBy || "").trim(),
    boundAt: new Date().toISOString(),
  }
  state.bindings[bindingKey(binding.groupId, binding.userId)] = binding
  return binding
}

export function createBindingRequest(state, input) {
  return createRequest(state, { ...input, kind: "binding", amount: null })
}

export function createBalanceRequest(state, input) {
  const amount = parsePositiveAmount(input.amount)
  return createRequest(state, { ...input, kind: "balance", amount })
}

export function hasPendingRequest(state, groupId, userId, kind = "") {
  return state.requests.some(
    request =>
      request.groupId === String(groupId) &&
      request.userId === String(userId) &&
      request.status === "pending" &&
      (!kind || request.kind === kind),
  )
}

export function findRequest(
  state,
  { requestId = "", messageId = "", text = "", groupId = "" } = {},
) {
  const request = state.requests.find(item => {
    if (groupId && item.groupId !== String(groupId)) return false
    return (
      (requestId && item.id === String(requestId).toUpperCase()) ||
      (messageId &&
        (item.messageId === String(messageId) || item.sourceMessageId === String(messageId))) ||
      (text && String(text).toUpperCase().includes(item.id))
    )
  })
  return request ?? null
}

export function markRequestApproving(state, requestId, approvedBy) {
  const request = requirePendingRequest(state, requestId)
  request.status = "approving"
  request.approvedBy = String(approvedBy || "").trim()
  request.approvingAt = new Date().toISOString()
  delete request.error
  return request
}

export function markRequestApproved(state, requestId, approvedBy = "") {
  const request = state.requests.find(item => item.id === String(requestId).toUpperCase())
  if (!request) throw new Error("余额申请不存在")
  request.status = "approved"
  request.approvedBy = String(approvedBy || request.approvedBy || "").trim()
  request.decidedAt = new Date().toISOString()
  return request
}

export function markRequestRejected(state, requestId, rejectedBy = "", reason = "") {
  const request = requirePendingRequest(state, requestId)
  request.status = "rejected"
  request.rejectedBy = String(rejectedBy || "").trim()
  request.reason = String(reason || "")
    .trim()
    .slice(0, 300)
  request.decidedAt = new Date().toISOString()
  return request
}

export function resetRequestToPending(state, requestId, error = "") {
  const request = state.requests.find(item => item.id === String(requestId).toUpperCase())
  if (!request) throw new Error("余额申请不存在")
  request.status = "pending"
  request.error = String(error || "")
    .trim()
    .slice(0, 300)
  delete request.approvedBy
  delete request.approvingAt
  return request
}

export function setRequestMessageId(state, requestId, messageId) {
  const request = state.requests.find(item => item.id === String(requestId).toUpperCase())
  if (!request || !messageId) return request ?? null
  request.messageId = String(messageId)
  return request
}

function createRequest(state, input) {
  const groupId = normalizeId(input.groupId, "群号")
  const userId = normalizeId(input.userId, "QQ号")
  const request = {
    id: createRequestId(),
    kind: input.kind,
    groupId,
    userId,
    accountId: parseS2aUserId(input.accountId),
    amount: input.amount === null ? null : parsePositiveAmount(input.amount),
    applicantName: String(input.applicantName || "")
      .trim()
      .slice(0, 80),
    reason: String(input.reason || "")
      .trim()
      .slice(0, 300),
    sourceMessageId: input.sourceMessageId ? String(input.sourceMessageId) : "",
    status: "pending",
    createdAt: new Date().toISOString(),
  }
  state.requests.push(request)
  return request
}

function requirePendingRequest(state, requestId) {
  const request = state.requests.find(item => item.id === String(requestId).toUpperCase())
  if (!request) throw new Error("余额申请不存在")
  if (request.status !== "pending") {
    throw new Error(`该申请已${requestStatusLabel(request.status)}`)
  }
  return request
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {}
  const requests = Array.isArray(source.requests)
    ? source.requests
        .filter(request => request && typeof request === "object")
        .map(recoverStaleApproval)
    : []
  const pending = requests.filter(request => ["pending", "approving"].includes(request?.status))
  const settled = requests
    .filter(request => !["pending", "approving"].includes(request?.status))
    .slice(-2000)
  return {
    version: BALANCE_REQUEST_STATE_VERSION,
    bindings: source.bindings && typeof source.bindings === "object" ? source.bindings : {},
    requests: [...pending, ...settled],
  }
}

function recoverStaleApproval(request) {
  if (
    request.status === "approving" &&
    Number.isFinite(Date.parse(request.approvingAt)) &&
    Date.now() - Date.parse(request.approvingAt) > 10 * 60 * 1000
  ) {
    const recovered = { ...request, status: "pending", error: "上次审批中断，已恢复为待审批" }
    delete recovered.approvingAt
    delete recovered.approvedBy
    return recovered
  }
  return request
}

function bindingKey(groupId, userId) {
  return `${String(groupId)}:${String(userId)}`
}

function normalizeId(value, label) {
  const normalized = String(value ?? "").trim()
  if (!/^\d+$/.test(normalized) || normalized === "0") throw new Error(`${label}无效`)
  return normalized
}

function createRequestId() {
  return `BR-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`
}

function requestStatusLabel(status) {
  return { approving: "处理中", approved: "通过", rejected: "拒绝" }[status] || "处理"
}
