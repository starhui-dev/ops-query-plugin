import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { formatQuotaAccountReference, parseQuotaAccountReference } from "./quota-account.js"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const configPath = path.join(pluginRoot, "config", "config.yaml")
export const defaultConfigPath = path.join(pluginRoot, "config", "config.example.yaml")

const editableFields = [
  "proxy.url",
  "proxy.cpaEnabled",
  "proxy.newapiEnabled",
  "proxy.codexRadarEnabled",
  "proxy.randomBackgroundEnabled",
  "cpa.baseUrl",
  "cpa.managementKey",
  "cpa.timeoutMs",
  "newapi.baseUrl",
  "newapi.accessToken",
  "newapi.timeoutMs",
  "newapi.channels",
  "display.timeZone",
  "access.groupWhitelist",
  "access.queryUsers",
  "alerts.enabled",
  "alerts.intervalMinutes",
  "alerts.targetGroups",
  "alerts.mentionMode",
  "alerts.mentionUsers",
  "alerts.accounts",
]
const secretFields = new Set(["proxy.url", "cpa.managementKey", "newapi.accessToken"])

export function loadConfig() {
  ensureConfigFile()
  return normalizeConfig(mergeConfig(readYaml(defaultConfigPath), readYaml(configPath)))
}

function normalizeConfig(config) {
  return {
    proxy: {
      url: String(config.proxy?.url || "").trim(),
      cpaEnabled: Boolean(config.proxy?.cpaEnabled),
      newapiEnabled: Boolean(config.proxy?.newapiEnabled),
      codexRadarEnabled: Boolean(config.proxy?.codexRadarEnabled),
      randomBackgroundEnabled: Boolean(config.proxy?.randomBackgroundEnabled),
    },
    cpa: normalizeServiceConfig(config.cpa, "managementKey"),
    newapi: {
      ...normalizeServiceConfig(config.newapi, "accessToken"),
      channels: normalizeNewapiChannels(config.newapi?.channels),
    },
    display: {
      timeZone: String(config.display?.timeZone || "Asia/Shanghai"),
    },
    access: {
      groupWhitelist: normalizeIdList(config.access?.groupWhitelist),
      queryUsers: normalizeIdList(config.access?.queryUsers),
    },
    alerts: {
      enabled: Boolean(config.alerts?.enabled),
      intervalMinutes: normalizeInterval(config.alerts?.intervalMinutes),
      targetGroups: normalizeIdList(config.alerts?.targetGroups),
      mentionMode: normalizeMentionMode(config.alerts?.mentionMode),
      mentionUsers: normalizeIdList(config.alerts?.mentionUsers),
      accounts: normalizeAlertAccounts(config.alerts?.accounts),
    },
  }
}

export function getGuobaConfig() {
  const config = loadConfig()
  config.proxy.url = ""
  config.cpa.managementKey = ""
  config.newapi.accessToken = ""
  config.newapi.channels = config.newapi.channels.map(channel => ({ ...channel, apiKey: "" }))
  return config
}

export function updateConfig(data) {
  const updated = normalizeConfig(applyConfigUpdate(loadConfig(), data))
  validateConfig(updated)
  writeYaml(configPath, updated)
  return updated
}

export function applyConfigUpdate(current, data) {
  const updated = structuredClone(current)
  for (const field of editableFields) {
    const value = readSubmittedValue(data, field)
    if (
      value === undefined ||
      (secretFields.has(field) && typeof value === "string" && value.trim() === "")
    ) {
      continue
    }
    setPath(updated, field, value)
  }
  if (Array.isArray(updated.newapi?.channels)) {
    updated.newapi.channels = keepSavedChannelKeys(
      current.newapi?.channels,
      updated.newapi.channels,
    )
  }
  return updated
}

// 锅巴不回显渠道 API Key，提交时 Key 留空表示沿用该渠道已保存的 Key。
function keepSavedChannelKeys(savedChannels, channels) {
  const savedKeys = new Map(
    (Array.isArray(savedChannels) ? savedChannels : []).map(channel => [
      Number(channel?.channelId),
      channel?.apiKey,
    ]),
  )
  return channels.map(channel => {
    const apiKey = String(channel?.apiKey ?? "").trim()
    return {
      ...channel,
      apiKey: apiKey || savedKeys.get(Number(channel?.channelId)) || "",
    }
  })
}

export function validateConfig(config) {
  validateOptionalProxyUrl(config.proxy?.url)
  if (hasEnabledProxyFeature(config.proxy) && !config.proxy?.url) {
    throw new Error("启用代理功能前必须填写代理地址")
  }
  validateOptionalUrl("CPA", config.cpa.baseUrl)
  validateOptionalUrl("NewAPI", config.newapi.baseUrl)
  validateTimeout("CPA", config.cpa.timeoutMs)
  validateTimeout("NewAPI", config.newapi.timeoutMs)
  const channelIds = new Set()
  for (const channel of config.newapi.channels) {
    if (channelIds.has(channel.channelId)) {
      throw new Error(`NewAPI 渠道设置不能重复：#${channel.channelId}`)
    }
    channelIds.add(channel.channelId)
  }
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: config.display.timeZone })
  } catch {
    throw new Error("显示时区无效")
  }
  if (
    !Number.isInteger(config.alerts.intervalMinutes) ||
    config.alerts.intervalMinutes < 1 ||
    config.alerts.intervalMinutes > 1440
  ) {
    throw new Error("告警检查间隔必须是 1 至 1440 分钟之间的整数")
  }
  if (!["none", "users", "all"].includes(config.alerts.mentionMode)) {
    throw new Error("告警提醒方式无效")
  }
  const seen = new Set()
  for (const rule of config.alerts.accounts) {
    if (!parseQuotaAccountReference(rule.account)) throw new Error("告警账号必须选择有效的额度账号")
    if (
      !Number.isFinite(rule.thresholdPercent) ||
      rule.thresholdPercent < 0 ||
      rule.thresholdPercent > 100
    ) {
      throw new Error("账号告警阈值必须在 0 至 100 之间")
    }
    if (seen.has(rule.account)) throw new Error(`告警账号不能重复：${rule.account}`)
    seen.add(rule.account)
  }
  if (config.alerts.enabled) {
    if (!config.alerts.accounts.length) throw new Error("启用告警前至少配置一个额度账号")
    if (!config.alerts.targetGroups.length) throw new Error("启用告警前至少选择一个目标群")
    const whitelist = new Set(config.access.groupWhitelist)
    if (config.alerts.targetGroups.some(groupId => !whitelist.has(groupId))) {
      throw new Error("告警目标群必须全部包含在群聊白名单中")
    }
    if (config.alerts.mentionMode === "users" && !config.alerts.mentionUsers.length) {
      throw new Error("选择 @指定用户 时至少配置一个提醒用户")
    }
  }
}

function normalizeServiceConfig(value, keyName) {
  return {
    baseUrl: String(value?.baseUrl || "")
      .trim()
      .replace(/\/+$/, ""),
    [keyName]: String(value?.[keyName] || "").trim(),
    timeoutMs: normalizeTimeout(value?.timeoutMs),
  }
}

function normalizeTimeout(value) {
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout >= 1000 && timeout <= 60000 ? timeout : 10000
}

function normalizeInterval(value) {
  const interval = Number(value)
  return Number.isInteger(interval) && interval >= 1 && interval <= 1440 ? interval : 10
}

function normalizeMentionMode(value) {
  const mode = String(value ?? "none").toLowerCase()
  return ["none", "users", "all"].includes(mode) ? mode : "none"
}

function normalizeIdList(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map(String)
        .map(item => item.trim())
        .filter(Boolean),
    ),
  ]
}

function normalizeNewapiChannels(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(channel => ({
      channelId: Number(channel?.channelId),
      enabled: channel?.enabled !== false,
      apiKey: String(channel?.apiKey ?? "").trim(),
    }))
    .filter(channel => Number.isSafeInteger(channel.channelId) && channel.channelId > 0)
}

function normalizeAlertAccounts(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(rule => {
      const parsed = parseQuotaAccountReference(rule?.account)
      return {
        account: formatQuotaAccountReference(parsed),
        thresholdPercent: Number(rule?.thresholdPercent),
      }
    })
    .filter(rule => rule.account)
}

function ensureConfigFile() {
  if (fs.existsSync(configPath)) {
    fs.chmodSync(configPath, 0o600)
    return
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.copyFileSync(defaultConfigPath, configPath)
  fs.chmodSync(configPath, 0o600)
}

function readYaml(file) {
  try {
    return YAML.parse(fs.readFileSync(file, "utf8")) ?? {}
  } catch (error) {
    throw new Error(`配置文件读取失败：${file}（${error.message}）`)
  }
}

function writeYaml(file, config) {
  const temporary = `${file}.tmp`
  try {
    fs.writeFileSync(temporary, YAML.stringify(config), { encoding: "utf8", mode: 0o600 })
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o600)
  } catch (error) {
    throw new Error(`配置文件保存失败：${error.message}`)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function mergeConfig(defaults, current) {
  return {
    proxy: { ...defaults.proxy, ...current.proxy },
    cpa: { ...defaults.cpa, ...current.cpa },
    newapi: { ...defaults.newapi, ...current.newapi },
    display: { ...defaults.display, ...current.display },
    access: { ...defaults.access, ...current.access },
    alerts: { ...defaults.alerts, ...current.alerts },
  }
}

function readSubmittedValue(data, field) {
  if (Object.hasOwn(data, field)) return data[field]
  return field.split(".").reduce((value, key) => value?.[key], data)
}

function setPath(target, field, value) {
  const keys = field.split(".")
  const leaf = keys.pop()
  const parent = keys.reduce((object, key) => (object[key] ??= {}), target)
  parent[leaf] = value
}

function validateOptionalUrl(name, value) {
  if (!value) return
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} 的服务地址不是有效 URL`)
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} 的服务地址只支持 HTTP 或 HTTPS`)
  }
}

function validateTimeout(name, value) {
  const timeout = Number(value)
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 60000) {
    throw new Error(`${name} 的请求超时必须是 1000 至 60000 毫秒之间的整数`)
  }
}

function validateOptionalProxyUrl(value) {
  if (!value) return
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error("代理地址不是有效 URL")
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("代理只支持 HTTP 或 HTTPS")
  }
}

function hasEnabledProxyFeature(proxy) {
  return [
    proxy?.cpaEnabled,
    proxy?.newapiEnabled,
    proxy?.codexRadarEnabled,
    proxy?.randomBackgroundEnabled,
  ].some(Boolean)
}

export function assertServiceConfig(name, config, keyName) {
  if (!config.baseUrl || !config[keyName]) {
    throw new Error(`${name} 尚未配置 baseUrl 或 ${keyName}`)
  }
  validateOptionalUrl(name, config.baseUrl)
}
