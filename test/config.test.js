import assert from "node:assert/strict"
import test from "node:test"
import { applyConfigUpdate, validateConfig } from "../lib/config.js"

const current = {
  proxy: {
    url: "http://user:password@127.0.0.1:7890",
    cpaEnabled: false,
    s2aEnabled: false,
    codexRadarEnabled: false,
    codexResetsEnabled: false,
    randomBackgroundEnabled: false,
  },
  cpa: { baseUrl: "https://cpa.old", managementKey: "cpa-secret", timeoutMs: 10000 },
  s2a: {
    baseUrl: "https://s2a.old",
    adminApiKey: "s2a-secret",
    timeoutMs: 10000,
    monitorVersion: "v1",
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
    codexResets: { enabled: false },
    sla: { enabled: false, thresholdPercent: 99.5, timeRange: "1h" },
  },
}

test("锅巴留空 CPA 与 S2A 密钥时保留原值", () => {
  const updated = applyConfigUpdate(current, {
    "cpa.managementKey": "",
    "s2a.adminApiKey": "",
  })
  assert.equal(updated.cpa.managementKey, "cpa-secret")
  assert.equal(updated.s2a.adminApiKey, "s2a-secret")
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
    "proxy.s2aEnabled": true,
    "proxy.codexRadarEnabled": true,
    "proxy.codexResetsEnabled": true,
    "proxy.randomBackgroundEnabled": true,
  })
  assert.deepEqual(updated.proxy, {
    ...current.proxy,
    cpaEnabled: true,
    s2aEnabled: true,
    codexRadarEnabled: true,
    codexResetsEnabled: true,
    randomBackgroundEnabled: true,
  })
})

test("锅巴可以切换 S2A 监控版本", () => {
  const updated = applyConfigUpdate(current, { "s2a.monitorVersion": "v2" })
  assert.equal(updated.s2a.monitorVersion, "v2")
})

test("锅巴可以配置 Sub2API SLA 告警", () => {
  const updated = applyConfigUpdate(current, {
    "alerts.sla.enabled": true,
    "alerts.sla.thresholdPercent": 99.9,
    "alerts.sla.timeRange": "6h",
  })
  assert.deepEqual(updated.alerts.sla, {
    enabled: true,
    thresholdPercent: 99.9,
    timeRange: "6h",
  })
})

test("锅巴可以配置 CPA OAuth 与 S2A Key 账号额度告警", () => {
  const updated = applyConfigUpdate(current, {
    "alerts.accounts": [
      { account: "cpa:claude:claude-a", thresholdPercent: 20 },
      { account: "cpa:codex:codex-a", thresholdPercent: 20 },
      { account: "s2a:kimi:26", thresholdPercent: 10 },
    ],
  })
  assert.deepEqual(updated.alerts.accounts, [
    { account: "cpa:claude:claude-a", thresholdPercent: 20 },
    { account: "cpa:codex:codex-a", thresholdPercent: 20 },
    { account: "s2a:kimi:26", thresholdPercent: 10 },
  ])
})

test("锅巴可以配置 Codex 重置订阅", () => {
  const updated = applyConfigUpdate(current, {
    "alerts.codexResets.enabled": true,
  })
  assert.deepEqual(updated.alerts.codexResets, { enabled: true })
})

test("校验 SLA 告警及群白名单", () => {
  const valid = {
    ...current,
    alerts: {
      ...current.alerts,
      enabled: true,
      intervalMinutes: 5,
      targetGroups: ["10001"],
      mentionMode: "users",
      mentionUsers: ["20001"],
      sla: { enabled: true, thresholdPercent: 99.5, timeRange: "1h" },
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
    "s2aEnabled",
    "codexRadarEnabled",
    "codexResetsEnabled",
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
    () => validateConfig({ ...current, s2a: { ...current.s2a, baseUrl: "file:///tmp/config" } }),
    /只支持 HTTP 或 HTTPS/,
  )
  assert.throws(
    () => validateConfig({ ...current, s2a: { ...current.s2a, timeoutMs: 100 } }),
    /1000 至 60000/,
  )
  assert.throws(
    () =>
      validateConfig({
        ...current,
        alerts: {
          ...current.alerts,
          sla: { enabled: true, thresholdPercent: 100.1, timeRange: "1h" },
        },
      }),
    /SLA 告警阈值必须在 0 至 100/,
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
          accounts: [{ account: "openai:16", thresholdPercent: 20 }],
        },
      }),
    /必须选择有效的额度账号/,
  )
})

test("启用告警时必须配置额度账号、Codex 重置订阅或 SLA 监控", () => {
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
    /至少配置一个额度账号、Codex 重置订阅或 SLA 监控/,
  )
  assert.doesNotThrow(() =>
    validateConfig({
      ...current,
      alerts: {
        ...current.alerts,
        enabled: true,
        targetGroups: ["10001"],
        codexResets: { enabled: true },
      },
    }),
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
  assert.doesNotThrow(() =>
    validateConfig({
      ...current,
      alerts: {
        ...current.alerts,
        enabled: true,
        targetGroups: ["10001"],
        sla: { enabled: true, thresholdPercent: 99.5, timeRange: "1h" },
      },
    }),
  )
})

test("校验旧版配置对象时兼容缺失的 Codex 重置订阅字段", () => {
  const { codexResets: _codexResets, ...legacyAlerts } = current.alerts
  assert.throws(
    () =>
      validateConfig({
        ...current,
        alerts: {
          ...legacyAlerts,
          enabled: true,
          targetGroups: ["10001"],
        },
      }),
    /至少配置一个额度账号、Codex 重置订阅或 SLA 监控/,
  )
})
