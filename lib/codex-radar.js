const CODEX_RADAR_URL = "https://codexradar.com/"
const REQUEST_TIMEOUT_MS = 15000
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export async function fetchLatestCodexRadarImage(fetchImpl = fetch) {
  const page = await fetchBytes(
    CODEX_RADAR_URL,
    {
      headers: {
        Accept: "text/html",
        "User-Agent": "ops-query-plugin/0.1",
      },
    },
    MAX_PAGE_BYTES,
    "Codex 雷达页面",
    fetchImpl,
  )
  const html = new TextDecoder().decode(page.bytes)
  const imageUrl = parseCodexRadarImageUrl(html, page.url)
  const image = await fetchBytes(
    imageUrl,
    {
      headers: {
        Accept: "image/*",
        Referer: CODEX_RADAR_URL,
        "User-Agent": "ops-query-plugin/0.1",
      },
    },
    MAX_IMAGE_BYTES,
    "Codex 雷达速览图",
    fetchImpl,
  )

  if (!image.contentType.startsWith("image/")) {
    throw new Error(`Codex 雷达速览图返回类型异常：${image.contentType || "未知"}`)
  }
  return image.bytes
}

export function parseCodexRadarImageUrl(html, pageUrl = CODEX_RADAR_URL) {
  const figure = html.match(
    /<figure\b[^>]*class=["'][^"']*\bmodel-iq-readout\b[^"']*["'][^>]*>[\s\S]*?<\/figure>/i,
  )?.[0]
  if (!figure || !/雷达速览图更新时间/.test(figure)) {
    throw new Error("Codex 雷达页面中未找到最新速览图")
  }

  const source = figure.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]
  if (!source) throw new Error("Codex 雷达速览图地址缺失")

  const imageUrl = new URL(decodeHtmlAttribute(source), pageUrl)
  if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "codexradar.com") {
    throw new Error("Codex 雷达速览图地址不受信任")
  }
  return imageUrl.href
}

async function fetchBytes(url, options, maxBytes, label, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  timer.unref?.()

  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "follow",
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${label}请求失败：HTTP ${response.status}`)

    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`${label}超过 ${formatMegabytes(maxBytes)}MB`)
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) throw new Error(`${label}内容为空`)
    if (bytes.length > maxBytes) throw new Error(`${label}超过 ${formatMegabytes(maxBytes)}MB`)
    return {
      bytes,
      contentType: String(response.headers.get("content-type") || "")
        .split(";")[0]
        .toLowerCase(),
      url: response.url || String(url),
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label}请求超时（${REQUEST_TIMEOUT_MS}ms）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function decodeHtmlAttribute(value) {
  return value.replace(/&amp;/gi, "&").replace(/&#38;/g, "&")
}

function formatMegabytes(bytes) {
  return bytes / 1024 / 1024
}
