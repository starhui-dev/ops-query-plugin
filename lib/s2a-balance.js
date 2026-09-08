import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"

export async function getS2aUser(config, userId, fetchImpl) {
  const id = parseS2aUserId(userId)
  assertServiceConfig("S2A", config, "adminApiKey")
  const payload = await s2aRequest(config, `/api/v1/admin/users/${id}`, {}, fetchImpl)
  return readResponseData(payload)
}

export async function getS2aUserByEmail(config, email, fetchImpl) {
  const normalized = normalizeEmail(email)
  assertServiceConfig("S2A", config, "adminApiKey")
  const params = new URLSearchParams({ search: normalized, page: "1", page_size: "20" })
  const payload = await s2aRequest(config, `/api/v1/admin/users?${params}`, {}, fetchImpl)
  const users = readUserList(payload)
  const exact = users.filter(
    user =>
      String(user?.email || "")
        .trim()
        .toLowerCase() === normalized,
  )
  if (!exact.length) throw new Error("S2A 中没有找到该邮箱对应的用户")
  if (exact.length > 1) throw new Error("S2A 中找到多个相同邮箱用户，请联系管理员处理")
  const user = exact[0]
  return { ...user, id: parseS2aUserId(user.id), email: normalized }
}

export async function addS2aUserBalance(
  config,
  userId,
  amount,
  notes = "",
  fetchImpl,
  idempotencyKey = "",
) {
  const id = parseS2aUserId(userId)
  const value = parsePositiveAmount(amount)
  assertServiceConfig("S2A", config, "adminApiKey")
  const payload = await s2aRequest(
    config,
    `/api/v1/admin/users/${id}/balance`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : {}),
      },
      body: JSON.stringify({
        balance: value,
        operation: "add",
        notes: String(notes).trim().slice(0, 500),
      }),
    },
    fetchImpl,
  )
  return readResponseData(payload)
}

export function parseS2aUserId(value) {
  const text = String(value ?? "").trim()
  const id = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error("S2A 用户账号 ID 必须是正整数")
  }
  return id
}

export function parsePositiveAmount(value) {
  const amount = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new Error("申请金额必须大于 0 且不超过 1000000")
  }
  return Math.round(amount * 100) / 100
}

async function s2aRequest(config, path, options = {}, fetchImpl) {
  return requestJson(
    new URL(path, `${config.baseUrl}/`),
    {
      ...options,
      headers: {
        "x-api-key": config.adminApiKey,
        ...options.headers,
      },
    },
    config.timeoutMs,
    fetchImpl,
  )
}

function readResponseData(payload) {
  if (Number(payload?.code ?? 0) !== 0) {
    throw new Error(String(payload?.message || "S2A 返回业务错误"))
  }
  return payload?.data && typeof payload.data === "object" ? payload.data : {}
}

function readUserList(payload) {
  if (Number(payload?.code ?? 0) !== 0) {
    throw new Error(String(payload?.message || "S2A 返回业务错误"))
  }
  const data = payload?.data
  const items = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(items)) throw new Error("S2A 用户列表响应格式无效")
  return items
}

function normalizeEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("邮箱地址无效")
  }
  return email
}
