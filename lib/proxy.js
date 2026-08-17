import { fetch as undiciFetch, ProxyAgent } from "undici"

export function selectProxy(proxy, feature) {
  return {
    enabled: Boolean(proxy?.[`${feature}Enabled`]),
    url: String(proxy?.url || "").trim(),
  }
}

export async function withProxy(proxy, callback, fetchImpl) {
  const proxyUrl = proxy?.enabled ? String(proxy.url || "").trim() : ""
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null
  const baseFetch = fetchImpl ?? (dispatcher ? undiciFetch : globalThis.fetch)
  const requestFetch = (url, options = {}) =>
    baseFetch(url, {
      ...options,
      ...(dispatcher ? { dispatcher } : {}),
    })

  try {
    return await callback(requestFetch)
  } finally {
    await dispatcher?.close()
  }
}
