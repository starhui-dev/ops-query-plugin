import assert from "node:assert/strict"
import test from "node:test"
import { applyConfigUpdate, validateConfig } from "../lib/config.js"

const current = {
  proxy: {
    url: "http://user:password@127.0.0.1:7890",
    cpaEnabled: false,
    newapiEnabled: false,
    codexRadarEnabled: false,
    randomBackgroundEnabled: false,
  },
  cpa: { baseUrl: "https://cpa.old", managementKey: "cpa-secret", timeoutMs: 10000 },
  newapi: {
    baseUrl: "https://newapi.old",
    accessToken: "newapi-secret",
    timeoutMs: 10000,
    channels: [
      { channelId: 12, enabled: true, apiKey: "kimi-secret" },
      { channelId: 13, enabled: false, apiKey: "" },
    ],
  },
  display: { timeZone: "Asia/Shanghai" },
  access: { groupWhitelist: ["10001"], queryUsers: ["20001"] },
  alerts: {
    enabled: false,
    intervalMinutes: 10,
    targetGroups: [],
    mentionMode: "none",
    mentionUsers: [],
    accounts: [],
  },
}

test("锅巴留空 CPA 与 NewAPI 密钥时保留原值", () => {
  const updated = applyConfigUpdate(current, {
    "cpa.managementKey": "",
    "newapi.accessToken": "",
  })
  assert.equal(updated.cpa.managementKey, "cpa-secret")
  assert.equal(updated.newapi.accessToken, "newapi-secret")
})

test("锅巴按渠道保存显示开关，渠道 API Key 留空时保留原值", () => {
  const updated = applyConfigUpdate(current, {
    "newapi.channels": [
      { channelId: 12, enabled: false, apiKey: "" },
      { channelId: "13", enabled: true, apiKey: " glm-secret " },
      { channelId: 14, enabled: true },
    ],
  })
  assert.deepEqual(updated.newapi.channels, [
    { channelId: 12, enabled: false, apiKey: "kimi-secret" },
    { channelId: "13", enabled: true, apiKey: "glm-secret" },
    { channelId: 14, enabled: true, apiKey: "" },
  ])
  assert.throws(
    () =>
      validateConfig({
        ...current,
        newapi: {
          ...current.newapi,
          channels: [
            { channelId: 12, enabled: true, apiKey: "" },
            { channelId: 12, enabled: false, apiKey: "" },
          ],
        },
      }),
    /NewAPI 渠道设置不能重复：#12/,
  )
})

test("锅巴留空代理地址时保留原值", () => {
  const updated = applyConfigUpdate(current, {
    "proxy.url": "",
  })
  assert.equal(updated.proxy.url, "http://user:password@127.0.0.1:7890")
})

test("锅巴可以分别选择走代理的功能", () => {
  const updated = applyConfigUpdate(current, {
    "proxy.cpaEnabled": true,
    "proxy.newapiEnabled": true,
    "proxy.codexRadarEnabled": true,
    "proxy.randomBackgroundEnabled": true,
  })
  assert.deepEqual(updated.proxy, {
    ...current.proxy,
    cpaEnabled: true,
    newapiEnabled: true,
    codexRadarEnabled: true,
    randomBackgroundEnabled: true,
  })
})

test("锅巴可以配置 CPA 与 NewAPI 账号额度告警", () => {
  const updated = applyConfigUpdate(current, {
    "alerts.accounts": [
      { account: "cpa:claude:claude-a", thresholdPercent: 20 },
      { account: "cpa:codex:codex-a", thresholdPercent: 20 },
      { account: "newapi:codex:12", thresholdPercent: 10 },
    ],
  })
  assert.deepEqual(updated.alerts.accounts, [
    { account: "cpa:claude:claude-a", thresholdPercent: 20 },
    { account: "cpa:codex:codex-a", thresholdPercent: 20 },
    { account: "newapi:codex:12", thresholdPercent: 10 },
  ])
})

test("校验告警群白名单", () => {
  const valid = {
    ...current,
    alerts: {
      ...current.alerts,
      enabled: true,
      intervalMinutes: 5,
      targetGroups: ["10001"],
      mentionMode: "users",
      mentionUsers: ["20001"],
      accounts: [{ account: "newapi:codex:12", thresholdPercent: 20 }],
    },
  }
  assert.doesNotThrow(() => validateConfig(valid))
  assert.throws(
    () => validateConfig({ ...valid, alerts: { ...valid.alerts, targetGroups: ["10002"] } }),
    /目标群必须全部包含在群聊白名单/,
  )
})

test("拒绝无效配置", () => {
  for (const field of [
    "cpaEnabled",
    "newapiEnabled",
    "codexRadarEnabled",
    "randomBackgroundEnabled",
  ]) {
    assert.throws(
      () =>
        validateConfig({
          ...current,
          proxy: { ...current.proxy, url: "", [field]: true },
        }),
      /启用代理功能前必须填写代理地址/,
    )
  }
  assert.throws(
    () =>
      validateConfig({
        ...current,
        proxy: { ...current.proxy, url: "socks5://127.0.0.1:7890" },
      }),
    /代理只支持 HTTP 或 HTTPS/,
  )
  assert.throws(
    () => validateConfig({ ...current, cpa: { ...current.cpa, baseUrl: "file:///tmp/config" } }),
    /只支持 HTTP 或 HTTPS/,
  )
  assert.throws(
    () =>
      validateConfig({
        ...current,
        newapi: { ...current.newapi, baseUrl: "file:///tmp/config" },
      }),
    /只支持 HTTP 或 HTTPS/,
  )
  assert.throws(
    () => validateConfig({ ...current, newapi: { ...current.newapi, timeoutMs: 100 } }),
    /1000 至 60000/,
  )
  assert.throws(
    () =>
      validateConfig({
        ...current,
        alerts: {
          ...current.alerts,
          accounts: [{ account: "cpa:codex:codex-a", thresholdPercent: 101 }],
        },
      }),
    /账号告警阈值必须在 0 至 100/,
  )
  assert.throws(
    () =>
      validateConfig({
        ...current,
        alerts: {
          ...current.alerts,
          accounts: [{ account: "openai:not-an-id", thresholdPercent: 20 }],
        },
      }),
    /必须选择有效的额度账号/,
  )
  for (const account of ["newapi:gemini:12", "newapi:codex:not-an-id"]) {
    assert.throws(
      () =>
        validateConfig({
          ...current,
          alerts: { ...current.alerts, accounts: [{ account, thresholdPercent: 20 }] },
        }),
      /必须选择有效的额度账号/,
      account,
    )
  }
})

test("启用告警时必须配置额度账号", () => {
  assert.throws(
    () =>
      validateConfig({
        ...current,
        alerts: {
          ...current.alerts,
          enabled: true,
          targetGroups: ["10001"],
        },
      }),
    /至少配置一个额度账号/,
  )
  assert.doesNotThrow(() =>
    validateConfig({
      ...current,
      alerts: {
        ...current.alerts,
        enabled: true,
        targetGroups: ["10001"],
        accounts: [{ account: "cpa:codex:codex-a", thresholdPercent: 20 }],
      },
    }),
  )
})
