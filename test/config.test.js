import assert from "node:assert/strict"
import test from "node:test"
import { applyConfigUpdate, validateConfig } from "../lib/config.js"

const current = {
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
    sla: { enabled: false, thresholdPercent: 99.5, timeRange: "1h" },
  },
}

test("锅巴留空密钥时保留原值", () => {
  const updated = applyConfigUpdate(current, {
    "cpa.baseUrl": "https://cpa.new",
    "cpa.managementKey": "",
    "s2a.adminApiKey": "",
  })
  assert.equal(updated.cpa.baseUrl, "https://cpa.new")
  assert.equal(updated.cpa.managementKey, "cpa-secret")
  assert.equal(updated.s2a.adminApiKey, "s2a-secret")
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

test("校验按账号告警及群白名单", () => {
  const valid = {
    ...current,
    alerts: {
      ...current.alerts,
      enabled: true,
      intervalMinutes: 5,
      targetGroups: ["10001"],
      mentionMode: "users",
      mentionUsers: ["20001"],
      accounts: [{ account: "codex:codex-a", thresholdPercent: 20 }],
    },
  }
  assert.doesNotThrow(() => validateConfig(valid))
  assert.throws(
    () => validateConfig({ ...valid, alerts: { ...valid.alerts, targetGroups: ["10002"] } }),
    /目标群必须全部包含在群聊白名单/,
  )
  assert.throws(
    () =>
      validateConfig({
        ...valid,
        alerts: {
          ...valid.alerts,
          accounts: [{ account: "codex:codex-a", thresholdPercent: 101 }],
        },
      }),
    /阈值必须在 0 至 100/,
  )
  assert.throws(
    () =>
      validateConfig({
        ...valid,
        alerts: {
          ...valid.alerts,
          accounts: [{ account: "kimi:kimi-a", thresholdPercent: 20 }],
        },
      }),
    /必须选择有效的 Codex 账号/,
  )
})

test("拒绝无效配置", () => {
  assert.throws(
    () => validateConfig({ ...current, cpa: { ...current.cpa, baseUrl: "file:///tmp/config" } }),
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
})

test("只启用 SLA 监控时不要求配置额度账号", () => {
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
