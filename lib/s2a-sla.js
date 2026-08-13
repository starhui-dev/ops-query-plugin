import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"

const ALERT_STATE_KEY = "s2a:sla"
const DEFAULT_TIME_RANGE = "1h"
const TIME_RANGE_LABELS = {
  "5m": "近 5 分钟",
  "30m": "近 30 分钟",
  "1h": "近 1 小时",
  "6h": "近 6 小时",
  "24h": "近 24 小时",
}

export async function queryS2aSla(config, timeRange = DEFAULT_TIME_RANGE) {
  assertServiceConfig("S2A", config, "adminApiKey")
  const range = normalizeTimeRange(timeRange)
  const query = new URLSearchParams({ time_range: range })
  const payload = await requestJson(
    new URL(`/api/v1/admin/ops/dashboard/overview?${query}`, `${config.baseUrl}/`),
    { headers: { "x-api-key": config.adminApiKey } },
    config.timeoutMs,
  )
  return readResponseData(payload)
}

export function formatS2aSlaOverview(
  overview,
  timeRange = DEFAULT_TIME_RANGE,
  timeZone = "Asia/Shanghai",
) {
  const requestCount = nonNegativeInteger(overview?.request_count_sla)
  const sla = finiteNumber(overview?.sla)
  const slaPercent = requestCount && sla !== null && sla >= 0 && sla <= 1 ? sla * 100 : null

  return [
    "Sub2API SLA",
    `${timeRangeLabel(timeRange)}｜${formatPeriod(overview?.start_time, overview?.end_time, timeZone)}`,
    `当前 SLA  ${formatSla(slaPercent)}`,
    `成功请求  ${nonNegativeInteger(overview?.success_count)}`,
    `异常数    ${nonNegativeInteger(overview?.error_count_sla)}`,
    `业务限制  ${nonNegativeInteger(overview?.business_limited_count)}（已排除）`,
    `SLA 请求  ${requestCount}`,
  ].join("\n")
}

export function evaluateS2aSlaAlert(rule, overview, states = new Map()) {
  if (!rule?.enabled) return null

  const requestCount = nonNegativeInteger(overview?.request_count_sla)
  const sla = finiteNumber(overview?.sla)
  if (!requestCount || sla === null || sla < 0 || sla > 1) return null

  const thresholdPercent = finiteNumber(rule.thresholdPercent)
  if (thresholdPercent === null) return null
  const slaPercent = sla * 100
  if (slaPercent >= thresholdPercent) {
    states.delete(ALERT_STATE_KEY)
    return null
  }
  if (states.get(ALERT_STATE_KEY) === "low") return null

  states.set(ALERT_STATE_KEY, "low")
  return {
    slaPercent,
    thresholdPercent,
    exceptionCount: nonNegativeInteger(overview?.error_count_sla),
    businessLimitedCount: nonNegativeInteger(overview?.business_limited_count),
    requestCount,
    successCount: nonNegativeInteger(overview?.success_count),
    timeRange: normalizeTimeRange(rule.timeRange),
    startTime: overview?.start_time,
    endTime: overview?.end_time,
  }
}

export function formatS2aSlaAlert(alert) {
  return [
    "Sub2API SLA 告警",
    `${timeRangeLabel(alert.timeRange)}内服务可用性低于阈值`,
    `当前 SLA  ${formatSla(alert.slaPercent)}`,
    `告警阈值  ${formatSla(alert.thresholdPercent)}`,
    `异常数    ${alert.exceptionCount}`,
    `业务限制  ${alert.businessLimitedCount}（已排除）`,
    `SLA 请求  ${alert.requestCount}`,
  ].join("\n")
}

export function buildS2aSlaAlertImageData(alert, timeZone = "Asia/Shanghai", now = Date.now()) {
  return {
    kicker: "S2A / SLA ALERT",
    title: "Sub2API SLA 告警",
    subtitle: "排除业务限制后的服务可用性低于设定阈值",
    updatedAt: formatImageTime(now, timeZone),
    timeRange: timeRangeLabel(alert.timeRange),
    period: formatPeriod(alert.startTime, alert.endTime, timeZone),
    sla: formatSla(alert.slaPercent),
    threshold: formatSla(alert.thresholdPercent),
    exceptionCount: String(alert.exceptionCount),
    businessLimitedCount: String(alert.businessLimitedCount),
    requestCount: String(alert.requestCount),
    successCount: String(alert.successCount),
    progress: clampPercent(alert.slaPercent),
  }
}

function readResponseData(payload) {
  if (Number(payload?.code ?? 0) !== 0) {
    throw new Error(String(payload?.message || "S2A SLA 返回业务错误"))
  }
  return payload?.data && typeof payload.data === "object" ? payload.data : {}
}

function normalizeTimeRange(value) {
  const range = String(value || "")
  return Object.hasOwn(TIME_RANGE_LABELS, range) ? range : DEFAULT_TIME_RANGE
}

function timeRangeLabel(value) {
  return TIME_RANGE_LABELS[normalizeTimeRange(value)]
}

function formatSla(value) {
  const number = finiteNumber(value)
  return number === null ? "-" : `${number.toFixed(3)}%`
}

function formatPeriod(start, end, timeZone) {
  const startText = formatImageTime(start, timeZone)
  const endText = formatImageTime(end, timeZone)
  return startText === "未知" || endText === "未知" ? "统计时间未知" : `${startText} - ${endText}`
}

function formatImageTime(value, timeZone) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return "未知"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeInteger(value) {
  const number = finiteNumber(value)
  return number === null ? 0 : Math.max(0, Math.trunc(number))
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, finiteNumber(value) || 0))
}
