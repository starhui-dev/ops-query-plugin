export class HttpError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

export async function requestJson(url, options = {}, timeoutMs = 10000, fetchImpl = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...options.headers,
      },
    })
    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        throw new HttpError(`接口返回的不是 JSON（HTTP ${response.status}）`, response.status)
      }
    }
    if (!response.ok) {
      throw new HttpError(readApiError(data) || `HTTP ${response.status}`, response.status)
    }
    return data
  } catch (error) {
    if (error?.name === "AbortError") throw new HttpError(`请求超时（${timeoutMs}ms）`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function readApiError(data) {
  if (!data || typeof data !== "object") return ""
  if (typeof data.message === "string") return data.message
  if (typeof data.error === "string") return data.error
  if (typeof data.error?.message === "string") return data.error.message
  return ""
}
