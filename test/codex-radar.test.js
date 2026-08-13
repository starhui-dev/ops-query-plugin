import assert from "node:assert/strict"
import test from "node:test"
import { fetchLatestCodexRadarImage, parseCodexRadarImageUrl } from "../lib/codex-radar.js"

const PAGE_URL = "https://codexradar.com/"
const IMAGE_URL = "https://codexradar.com/assets/radar-latest.png?v=20260813&amp;size=full"

test("从速览区块解析最新 Codex 雷达图片地址", () => {
  const html = `
    <img src="assets/unrelated.png" alt="其他图片">
    <figure class="model-iq-readout">
      <img src="assets/radar-latest.png?v=20260813&amp;size=full" alt="Codex 雷达站速览">
      <figcaption>雷达速览图更新时间：8月13日 13:51</figcaption>
    </figure>
  `

  assert.equal(
    parseCodexRadarImageUrl(html),
    "https://codexradar.com/assets/radar-latest.png?v=20260813&size=full",
  )
})

test("拒绝速览区块中的站外图片地址", () => {
  const html = `
    <figure class="model-iq-readout">
      <img src="https://example.com/radar.png">
      <figcaption>雷达速览图更新时间：8月13日 13:51</figcaption>
    </figure>
  `

  assert.throws(() => parseCodexRadarImageUrl(html), /地址不受信任/)
})

test("下载页面指向的最新速览图片", async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(String(url))
    if (String(url) === PAGE_URL) {
      return response(
        `<figure class="model-iq-readout"><img src="${IMAGE_URL}"><figcaption>雷达速览图更新时间：现在</figcaption></figure>`,
        "text/html; charset=utf-8",
        PAGE_URL,
      )
    }
    return response("png bytes", "image/png", String(url))
  }

  const image = await fetchLatestCodexRadarImage(fetchImpl)

  assert.deepEqual(calls, [
    PAGE_URL,
    "https://codexradar.com/assets/radar-latest.png?v=20260813&size=full",
  ])
  assert.equal(image.toString(), "png bytes")
})

test("拒绝非图片类型的速览资源", async () => {
  const fetchImpl = async url => {
    if (String(url) === PAGE_URL) {
      return response(
        `<figure class="model-iq-readout"><img src="assets/radar.png"><figcaption>雷达速览图更新时间：现在</figcaption></figure>`,
        "text/html",
        PAGE_URL,
      )
    }
    return response("not an image", "text/plain", String(url))
  }

  await assert.rejects(fetchLatestCodexRadarImage(fetchImpl), /返回类型异常/)
})

function response(body, contentType, url) {
  const bytes = Buffer.from(body)
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({
      "content-length": String(bytes.length),
      "content-type": contentType,
    }),
    arrayBuffer: async () => bytes,
  }
}
