import assert from "node:assert/strict"
import test from "node:test"
import { selectProxy, withProxy } from "../lib/proxy.js"

const proxy = {
  url: "http://127.0.0.1:7890",
  cpaEnabled: true,
  newapiEnabled: false,
  codexRadarEnabled: true,
}

test("只为选中的功能启用代理", () => {
  assert.deepEqual(selectProxy(proxy, "cpa"), {
    enabled: true,
    url: proxy.url,
  })
  assert.deepEqual(selectProxy(proxy, "newapi"), {
    enabled: false,
    url: proxy.url,
  })
  assert.deepEqual(selectProxy(proxy, "codexRadar"), {
    enabled: true,
    url: proxy.url,
  })
})

test("未选中的功能不会附加代理 dispatcher", async () => {
  const options = await withProxy(
    selectProxy(proxy, "newapi"),
    requestFetch => requestFetch("https://newapi.example.com"),
    async (_url, requestOptions) => requestOptions,
  )

  assert.equal(options.dispatcher, undefined)
})
