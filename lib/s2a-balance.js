import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"

export async function getS2aUser(config, userId, fetchImpl) {
  const id = parseS2aUserId(userId)
  assertServiceConfig("S2A", config, "adminApiKey")
  const payload = await s2aRequest(config, `/api/v1/admin/users/${id}`, {}, fetchImpl)
  return readResponseData(payload)
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
