import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"

export async function queryS2aMonitors(config, fetchImpl) {
  assertServiceConfig("S2A", config, "adminApiKey")
  const monitors = []
  let page = 1
  let pages = 1

  do {
    const payload = await s2aRequest(
      config,
      `/api/v1/admin/channel-monitors?page=${page}&page_size=100`,
      fetchImpl,
    )
    const data = readResponseData(payload)
    if (Array.isArray(data.items)) monitors.push(...data.items)
    pages = Math.max(1, Number(data.pages) || 1)
    page += 1
  } while (page <= pages)

  return Promise.all(monitors.map(monitor => appendLatestPing(config, monitor, fetchImpl)))
}

export function getLatestPingLatency(payload) {
  const item = payload?.data?.items?.[0]
  const value = item?.ping_latency_ms
  if (value === null || value === undefined || value === "") return null
  const latency = Number(value)
  return Number.isFinite(latency) ? latency : null
}

export function getRecentChecks(payload) {
  const items = payload?.data?.items
  if (!Array.isArray(items)) return []
  return items
    .filter(item => item && typeof item === "object")
    .slice(0, 60)
    .reverse()
}

export function formatS2aSummary(monitors) {
  const counts = { operational: 0, degraded: 0, unavailable: 0, disabled: 0, unknown: 0 }
  for (const monitor of monitors) counts[monitorState(monitor)] += 1
  return [
    "S2A 渠道监控",
    `共 ${monitors.length} 个｜正常 ${counts.operational}｜降级 ${counts.degraded}｜异常 ${counts.unavailable}｜停用 ${counts.disabled}｜未知 ${counts.unknown}`,
  ].join("\n")
}

export function formatS2aMonitor(monitor, timeZone = "Asia/Shanghai") {
  return [
    `${singleLine(monitor?.name || `监控 ${monitor?.id ?? "?"}`)} · ${statusLabel(monitor)}`,
    `提供商  ${singleLine(providerLabel(monitor?.provider))}`,
    `模型      ${singleLine(monitor?.primary_model || "未知模型")}`,
    `对话延迟  ${formatLatency(monitor?.primary_latency_ms)}`,
    `端点 Ping ${formatLatency(monitor?.primary_ping_latency_ms)}`,
    `7天可用率 ${formatAvailability(monitor?.availability_7d)}`,
    `最后检测  ${formatCheckedAt(monitor?.last_checked_at, timeZone)}`,
  ].join("\n")
}

export function formatS2aForwardNodes(monitors, timeZone = "Asia/Shanghai") {
  return [
    formatS2aSummary(monitors),
    ...monitors.map(monitor => formatS2aMonitor(monitor, timeZone)),
  ]
}

export function formatS2aReport(monitors, timeZone = "Asia/Shanghai") {
  return formatS2aForwardNodes(monitors, timeZone).join("\n\n")
}

export function buildS2aImageData(monitors, timeZone = "Asia/Shanghai", now = Date.now()) {
  const counts = { operational: 0, degraded: 0, unavailable: 0, disabled: 0, unknown: 0 }
  for (const monitor of monitors) counts[monitorState(monitor)] += 1

  const problemCount = counts.degraded + counts.unavailable
  const overallLabel = problemCount
    ? `${problemCount} 个渠道异常`
    : counts.disabled + counts.unknown
      ? `${counts.disabled + counts.unknown} 个渠道未监控`
      : "全部渠道正常"

  return {
    theme: "s2a",
    kicker: "S2A / CHANNEL MONITOR",
    title: "渠道状态",
    subtitle: "Sub2API 实时可用性与延迟",
    updatedAt: formatImageTime(now, timeZone),
    periodLabel: "最近 60 次检测",
    overallLabel,
    overallTone: problemCount ? (counts.unavailable ? "danger" : "warning") : "success",
    refreshLabel: `更新于 ${formatImageTime(now, timeZone)}`,
    counts: {
      total: String(monitors.length),
      operational: String(counts.operational),
      problem: String(problemCount),
    },
    channels: monitors.map(monitor => {
      const state = monitorState(monitor)
      const availability = finiteNumber(monitor?.availability_7d)
      return {
        title: singleLine(monitor?.name || `监控 ${monitor?.id ?? "?"}`),
        provider: providerLabel(monitor?.provider),
        model: singleLine(monitor?.primary_model || "未知模型"),
        badge: statusLabel(monitor),
        badgeTone: stateTone(state),
        latency: formatLatency(monitor?.primary_latency_ms),
        latencyTone: latencyTone(monitor?.primary_latency_ms),
        ping: formatLatency(monitor?.primary_ping_latency_ms),
        pingTone: latencyTone(monitor?.primary_ping_latency_ms),
        availability: availability === null ? "未知" : `${availability.toFixed(2)}%`,
        availabilityTone: availabilityTone(availability),
        checkedAt: formatCheckedAt(monitor?.last_checked_at, timeZone),
        checks: normalizeChecks(monitor?.recent_checks, timeZone),
      }
    }),
  }
}

async function appendLatestPing(config, monitor, fetchImpl) {
  if (!monitor?.id || !monitor?.primary_model) return monitor
  const query = new URLSearchParams({ limit: "60", model: String(monitor.primary_model) })
  try {
    const payload = await s2aRequest(
      config,
      `/api/v1/admin/channel-monitors/${monitor.id}/history?${query}`,
      fetchImpl,
    )
    readResponseData(payload)
    return {
      ...monitor,
      primary_ping_latency_ms: getLatestPingLatency(payload),
      recent_checks: getRecentChecks(payload),
    }
  } catch {
    return { ...monitor, primary_ping_latency_ms: null, recent_checks: [] }
  }
}

async function s2aRequest(config, path, fetchImpl) {
  return requestJson(
    new URL(path, `${config.baseUrl}/`),
    { headers: { "x-api-key": config.adminApiKey } },
    config.timeoutMs,
    fetchImpl,
  )
}

function readResponseData(payload) {
  if (Number(payload?.code ?? 0) !== 0) {
    throw new Error(String(payload?.message || "S2A 返回业务错误"))
  }
  return payload?.data ?? {}
}

function monitorState(monitor) {
  if (!monitor?.enabled) return "disabled"
  const status = String(monitor?.primary_status || "").toLowerCase()
  if (status === "operational") return "operational"
  if (status === "degraded") return "degraded"
  if (["failed", "error", "unavailable"].includes(status)) return "unavailable"
  return "unknown"
}

function statusLabel(monitor) {
  const labels = {
    operational: "正常",
    degraded: "降级",
    unavailable: "异常",
    disabled: "停用",
    unknown: "未知",
  }
  return labels[monitorState(monitor)]
}

function providerLabel(provider) {
  const normalized = String(provider || "unknown").toLowerCase()
  const labels = { openai: "OpenAI", gemini: "Gemini", anthropic: "Anthropic" }
  return labels[normalized] || normalized
}

function formatLatency(value) {
  const latency = Number(value)
  return Number.isFinite(latency) ? `${latency}ms` : "未知"
}

function formatAvailability(value) {
  const availability = Number(value)
  return Number.isFinite(availability) ? `${availability.toFixed(2)}%` : "未知"
}

function formatCheckedAt(value, timeZone) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return "未知"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function stateTone(state) {
  if (state === "operational") return "success"
  if (state === "degraded") return "warning"
  if (state === "unavailable") return "danger"
  return "muted"
}

function availabilityTone(value) {
  if (value === null) return "muted"
  if (value < 95) return "danger"
  if (value < 99) return "warning"
  return "success"
}

function latencyTone(value) {
  const latency = finiteNumber(value)
  if (latency === null) return "muted"
  if (latency >= 5000) return "danger"
  if (latency >= 2000) return "warning"
  return "info"
}

function normalizeChecks(value, timeZone) {
  if (!Array.isArray(value)) return []
  return value.slice(-60).map(item => ({
    tone: historyTone(item?.status),
    label: `${formatCheckedAt(item?.checked_at, timeZone)} · ${historyStatusLabel(item?.status)}`,
  }))
}

function historyTone(value) {
  const status = String(value || "").toLowerCase()
  if (status === "operational") return "success"
  if (status === "degraded") return "warning"
  if (["failed", "error", "unavailable"].includes(status)) return "danger"
  return "muted"
}

function historyStatusLabel(value) {
  const status = String(value || "").toLowerCase()
  if (status === "operational") return "正常"
  if (status === "degraded") return "降级"
  if (["failed", "error", "unavailable"].includes(status)) return "异常"
  return "未知"
}

function formatImageTime(value, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

function singleLine(value) {
  return String(value).replace(/[\r\n]+/g, " ")
}
