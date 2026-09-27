import { accountDisplayName, getQuotaRemainingPercentages } from "./account-quota.js"
import { assertServiceConfig } from "./config.js"
import { buildCodexWindows, buildKimiWindows } from "./cpa-quota.js"
import { requestJson } from "./http.js"
import { formatQuotaAccountReference } from "./quota-account.js"
import { newapiChannelPlatform } from "./quota-platforms.js"

// NewAPI 服务端把 page_size 限制在 100 以内。
const PAGE_SIZE = 100
const CHANNEL_STATUS_MANUALLY_DISABLED = 2

export async function listNewapiQuotaChannels(config, fetchImpl) {
  assertServiceConfig("NewAPI", config, "accessToken")
  const channels = []
  let page = 1
  let total = 0

  do {
    const query = new URLSearchParams({ p: String(page), page_size: String(PAGE_SIZE) })
    const data = readResponseData(await newapiRequest(config, `/api/channel/?${query}`, fetchImpl))
    const items = Array.isArray(data?.items) ? data.items : []
    channels.push(...items)
    total = Number(data?.total) || 0
    page += 1
    if (!items.length) break
  } while (channels.length < total)

  return channels.filter(isQuotaChannel)
}

// 锅巴“渠道设置”的可选渠道：只列出插件能展示额度的渠道，不发起额度查询，
// 这样尚未填写 Key 的 Kimi/GLM 渠道也能被选中配置。
export async function listNewapiChannelOptions(config, fetchImpl) {
  const channels = await listNewapiQuotaChannels(config, fetchImpl)
  return channels.map(channel => ({
    label: `${newapiChannelPlatform(channel).label} · ${accountDisplayName(channel.name)}（#${channel.id}）`,
    value: Number(channel.id),
  }))
}

// 告警按剩余百分比判断，只有余额的渠道选了也不会触发，因此不作为告警选项。
// 显示开关只控制 #账号额度，关闭显示的渠道仍可设置告警。
export async function listNewapiQuotaAccountOptions(config, fetchImpl) {
  const results = await queryNewapiQuota(config, "Asia/Shanghai", [], fetchImpl)
  return results
    .filter(result => getQuotaRemainingPercentages(result).length)
    .map(result => ({
      label: `NewAPI · ${result.label} · ${accountDisplayName(result.account.name)}`,
      value: formatQuotaAccountReference({
        source: "newapi",
        platform: result.platform,
        accountId: result.account.id,
      }),
    }))
}

export async function queryNewapiQuota(
  config,
  timeZone = "Asia/Shanghai",
  channelIds = [],
  fetchImpl,
  { respectDisplay = false } = {},
) {
  const settings = channelSettings(config.channels)
  const channels = selectChannels(
    await listNewapiQuotaChannels(config, fetchImpl),
    channelIds,
  ).filter(channel => !respectDisplay || settings.get(Number(channel.id))?.enabled !== false)
  const results = await Promise.all(
    channels.map(channel =>
      buildQuotaResult(config, channel, settings.get(Number(channel.id)), timeZone, fetchImpl),
    ),
  )
  return results.filter(result => result?.windows.length)
}

async function buildQuotaResult(config, channel, setting, timeZone, fetchImpl) {
  const platform = newapiChannelPlatform(channel)
  const isCodex = platform.key === "codex"
  const base = {
    source: "newapi",
    platform: platform.key,
    label: platform.label,
    account: {
      id: Number(channel.id),
      name: channel.name,
      platform: platform.key,
      type: isCodex ? "oauth" : "apikey",
      source: "newapi",
    },
    plan: null,
    timeZone,
  }

  if (isCodex) {
    try {
      const payload = readCodexUsage(
        await newapiRequest(config, `/api/channel/${channel.id}/codex/usage`, fetchImpl),
      )
      return {
        ...base,
        plan: firstString(payload.plan_type, payload.planType) || null,
        windows: buildCodexWindows(payload),
      }
    } catch {
      // 与 CPA 一致：凭据失效或上游不可用时隐藏该账号，不影响其它账号展示。
      return null
    }
  }

  if (platform.requiresApiKey) {
    // 未配置 Key 时无法查询，即使显示开关打开也不展示。
    if (!setting?.apiKey) return null
    try {
      return { ...base, ...(await queryCodingPlan(config, platform, setting.apiKey, fetchImpl)) }
    } catch {
      return null
    }
  }

  if (platform.balanceUrl && setting?.apiKey) {
    try {
      return {
        ...base,
        windows: await queryUpstreamBalance(config, platform, setting.apiKey, fetchImpl),
      }
    } catch {
      // Key 无效或上游不可用时隐藏，不回落到 NewAPI 缓存，避免两种口径的余额混在一起。
      return null
    }
  }

  const window = balanceWindow(channel, platform.currency, timeZone)
  return window ? { ...base, windows: [window] } : null
}

// DeepSeek /user/balance：balance_infos 每种币种一项，金额均为字符串；
// total_balance = granted_balance（未过期赠送）+ topped_up_balance（充值）。
async function queryUpstreamBalance(config, platform, apiKey, fetchImpl) {
  const payload = await requestJson(
    platform.balanceUrl,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    config.timeoutMs,
    fetchImpl,
  )
  const available = payload?.is_available !== false
  return (Array.isArray(payload?.balance_infos) ? payload.balance_infos : [])
    .map(info => {
      const balance = numberValue(info?.total_balance)
      if (balance === null) return null
      const currency = firstString(info?.currency)
      const granted = numberValue(info?.granted_balance)
      const toppedUp = numberValue(info?.topped_up_balance)
      return {
        label: currency ? `余额 ${currency}` : "余额",
        usedPercent: null,
        balance,
        currency,
        available,
        detail: [
          toppedUp === null ? "" : `充值 ${formatAmount(toppedUp)}`,
          granted === null ? "" : `赠送 ${formatAmount(granted)}`,
          available ? "" : "余额不足",
        ]
          .filter(Boolean)
          .join("｜"),
        resetAt: null,
      }
    })
    .filter(Boolean)
}

async function queryCodingPlan(config, platform, apiKey, fetchImpl) {
  if (platform.key === "kimi") {
    const payload = await requestJson(
      platform.usageUrl,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      config.timeoutMs,
      fetchImpl,
    )
    return { plan: null, windows: buildKimiWindows(payload) }
  }

  // 智谱额度接口的 Authorization 直接放 Key，不加 Bearer 前缀。
  const payload = await requestJson(
    platform.usageUrl,
    {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en",
      },
    },
    config.timeoutMs,
    fetchImpl,
  )
  if (payload?.success === false) throw new Error(String(payload?.msg || "GLM 额度接口返回错误"))
  return {
    plan: firstString(payload?.data?.level) || null,
    windows: buildGlmWindows(payload?.data),
  }
}

// 解析 GLM Coding Plan 的 data.limits，口径与 Sub2API / cc-switch 一致：
// TOKENS_LIMIT 按 unit 分类（3=5 小时，6=每周），不能按重置时间排序代替，周期末尾周窗口可能比
// 5 小时窗口更早重置；unit 缺失时无重置时间的条目优先归 5 小时，其余按重置时间依次填入。
// 只有 CREDIT_LIMIT 的套餐才退而展示信用额度，避免两种度量混在同一窗口。
function buildGlmWindows(data) {
  const entries = (Array.isArray(data?.limits) ? data.limits : []).map(item => ({
    type: String(item?.type ?? "")
      .trim()
      .toUpperCase(),
    unit: Number(item?.unit),
    usedPercent: clampPercent(numberValue(item?.percentage) ?? 0),
    resetAt: parseResetTime(item?.nextResetTime),
  }))
  const tokens = entries.filter(entry => entry.type === "TOKENS_LIMIT")
  const candidates = tokens.length ? tokens : entries.filter(entry => entry.type === "CREDIT_LIMIT")

  let fiveHour = null
  let weekly = null
  const unclassified = []
  for (const entry of candidates) {
    if (entry.type === "TOKENS_LIMIT" && entry.unit === 3 && !fiveHour) fiveHour = entry
    else if (entry.type === "TOKENS_LIMIT" && entry.unit === 6 && !weekly) weekly = entry
    else unclassified.push(entry)
  }
  unclassified.sort((left, right) => {
    if (Boolean(left.resetAt) !== Boolean(right.resetAt)) return left.resetAt ? 1 : -1
    return (left.resetAt?.getTime() ?? 0) - (right.resetAt?.getTime() ?? 0)
  })
  for (const entry of unclassified) {
    if (!fiveHour) fiveHour = entry
    else if (!weekly) weekly = entry
  }

  return [
    fiveHour && { label: "5 小时", usedPercent: fiveHour.usedPercent, resetAt: fiveHour.resetAt },
    weekly && { label: "每周", usedPercent: weekly.usedPercent, resetAt: weekly.resetAt },
  ].filter(Boolean)
}

function parseResetTime(value) {
  const numeric = numberValue(value)
  const date =
    numeric !== null
      ? numeric > 0
        ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
        : null
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

// 只读 NewAPI 已缓存的余额；刷新余额的接口会请求上游并写库，查询和告警都不应触发。
function balanceWindow(channel, currency, timeZone) {
  const updatedAt = Number(channel?.balance_updated_time)
  const balance = Number(channel?.balance)
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || !Number.isFinite(balance)) return null
  return {
    label: `余额 ${currency}`,
    usedPercent: null,
    balance,
    currency,
    available: true,
    detail: `更新于 ${formatTime(new Date(updatedAt * 1000), timeZone)}`,
    resetAt: null,
  }
}

function isQuotaChannel(channel) {
  const id = Number(channel?.id)
  if (!Number.isSafeInteger(id) || id <= 0) return false
  if (Number(channel?.status) === CHANNEL_STATUS_MANUALLY_DISABLED) return false
  const platform = newapiChannelPlatform(channel)
  if (!platform) return false
  // NewAPI 的 Codex 用量接口和余额都不支持多密钥渠道；Kimi/GLM 使用插件配置的 Key，不受影响。
  return platform.requiresApiKey || !channel?.channel_info?.is_multi_key
}

function channelSettings(value) {
  return new Map((Array.isArray(value) ? value : []).map(item => [Number(item.channelId), item]))
}

function selectChannels(channels, channelIds) {
  const selected = new Set(channelIds.map(String).filter(Boolean))
  return selected.size ? channels.filter(channel => selected.has(String(channel.id))) : channels
}

async function newapiRequest(config, path, fetchImpl) {
  return requestJson(
    new URL(path, `${config.baseUrl}/`),
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
    config.timeoutMs,
    fetchImpl,
  )
}

function readResponseData(payload) {
  if (payload?.success !== true) {
    throw new Error(String(payload?.message || "NewAPI 返回业务错误"))
  }
  return payload.data
}

function readCodexUsage(payload) {
  const data = readResponseData(payload)
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("NewAPI Codex 用量响应格式无效")
  }
  return data
}

function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatAmount(value) {
  return Number(value.toFixed(2)).toString()
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function firstString(...values) {
  const value = values.find(item => item !== undefined && item !== null && String(item).trim())
  return value === undefined ? "" : String(value).trim()
}
