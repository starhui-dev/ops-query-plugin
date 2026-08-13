import { assertServiceConfig } from "./config.js"
import { requestJson } from "./http.js"

const DEFAULT_RANGE = "90m"
const DEFAULT_GROUP_BY = "platform_group"
const RANGE_LABELS = {
  "90m": "最近 90 分钟",
  "24h": "最近 24 小时",
  "7d": "最近 7 天",
  "30d": "最近 30 天",
}

export async function queryS2aV2Monitor(config) {
  assertServiceConfig("S2A", config, "adminApiKey")
  const range = RANGE_LABELS[config.range] ? config.range : DEFAULT_RANGE
  const query = new URLSearchParams({ range })
  const matrixQuery = new URLSearchParams(query)
  matrixQuery.set("group_by", DEFAULT_GROUP_BY)
  const basePath = "/api/v1/admin/channel-monitor-v2"

  const [snapshot, matrix, models] = await Promise.all([
    s2aV2Request(config, `${basePath}/snapshot?${query}`),
    s2aV2Request(config, `${basePath}/matrix?${matrixQuery}`),
    s2aV2Request(config, `${basePath}/models?${query}`),
  ])

  return {
    range,
    snapshot: readResponseData(snapshot),
    matrix: readResponseData(matrix),
    models: readResponseData(models),
  }
}

export function buildS2aV2ImageData(report, timeZone = "Asia/Shanghai", now = Date.now()) {
  const snapshot = objectValue(report?.snapshot)
  const metrics = objectValue(snapshot.metrics)
  const health = objectValue(snapshot.health)
  const coverage = objectValue(snapshot.coverage)
  const matrixCoverage = objectValue(report?.matrix?.coverage)
  const matrixRows = arrayValue(report?.matrix?.items).map(row =>
    buildMatrixRow(row, Object.keys(matrixCoverage).length ? matrixCoverage : coverage),
  )
  const models = arrayValue(report?.models?.items).map(buildModelRow)
  const overallTone = healthTone(health.overall, health.score)

  return {
    theme: "s2a-v2",
    kicker: "S2A / PASSIVE MONITOR V2",
    title: "渠道状态 V2",
    subtitle: "Sub2API 请求质量、延迟与吞吐概览",
    rangeLabel: RANGE_LABELS[report?.range] || RANGE_LABELS[DEFAULT_RANGE],
    updatedAt: formatImageTime(coverage.data_through, timeZone),
    generatedAt: formatImageTime(now, timeZone),
    overallLabel: overallLabel(health, metrics),
    overallTone,
    coverageLabel: coverageLabel(coverage),
    bucketLabel: formatBucket(coverage.bucket_seconds),
    summary: {
      successRate: formatSuccessRate(metrics),
      errorRate: formatPercent(metrics.error_rate, metricsHaveTraffic(metrics)),
      ttft: formatLatency(metrics.ttft?.p50_ms),
      ttftDetail: formatLatencyDetail(metrics.ttft),
      tps: formatTps(metrics.tpm, metricsHaveTraffic(metrics)),
      cacheRate: formatPercent(metrics.cache_rate, metricsHaveTraffic(metrics)),
      rpm: formatRate(metrics.rpm, metricsHaveTraffic(metrics)),
    },
    axis: buildAxis(coverage, timeZone),
    matrixRows,
    models,
    modelCount: String(models.length),
  }
}

export function formatS2aV2ForwardNodes(report, timeZone = "Asia/Shanghai") {
  const data = buildS2aV2ImageData(report, timeZone)
  const summary = [
    "S2A 渠道监控 V2",
    `${data.rangeLabel}｜数据截至 ${data.updatedAt}`,
    `成功率 ${data.summary.successRate}｜首 Token P50 ${data.summary.ttft}｜每秒 Token ${data.summary.tps}`,
    `缓存率 ${data.summary.cacheRate}｜RPM ${data.summary.rpm}`,
  ].join("\n")
  return [
    summary,
    ...data.models.map(
      model =>
        `${model.platform} · ${model.model}\n成功率 ${model.successRate}｜首 Token ${model.ttft}｜每秒 Token ${model.tps}\n缓存率 ${model.cacheRate}｜RPM ${model.rpm}`,
    ),
  ]
}

async function s2aV2Request(config, path) {
  return requestJson(
    new URL(path, `${config.baseUrl}/`),
    { headers: { "x-api-key": config.adminApiKey } },
    config.timeoutMs,
  )
}

function readResponseData(payload) {
  if (Number(payload?.code ?? 0) !== 0) {
    throw new Error(String(payload?.message || "S2A V2 返回业务错误"))
  }
  return objectValue(payload?.data)
}

function buildMatrixRow(row, fallbackCoverage) {
  const metrics = objectValue(row?.metrics)
  const coverage = objectValue(row?.coverage)
  const buckets = alignBuckets(
    objectValue(Object.keys(coverage).length ? coverage : fallbackCoverage),
    arrayValue(row?.buckets),
  )
  return {
    label: matrixLabel(row),
    successRate: formatSuccessRate(metrics),
    ttft: formatLatency(metrics.ttft?.p50_ms),
    tps: formatTps(metrics.tpm, metricsHaveTraffic(metrics)),
    cacheRate: formatPercent(metrics.cache_rate, metricsHaveTraffic(metrics)),
    rpm: formatRate(metrics.rpm, metricsHaveTraffic(metrics)),
    tone: healthTone(row?.health?.overall, row?.health?.score),
    buckets,
  }
}

function buildModelRow(row) {
  const metrics = objectValue(row?.metrics)
  return {
    platform: singleLine(row?.platform || "unknown"),
    model: singleLine(row?.model === "__other__" ? "其他模型" : row?.model || "未知模型"),
    successRate: formatSuccessRate(metrics),
    errorRate: formatPercent(metrics.error_rate, metricsHaveTraffic(metrics)),
    ttft: formatLatency(metrics.ttft?.p50_ms),
    ttftDetail: formatLatencyDetail(metrics.ttft),
    tps: formatTps(metrics.tpm, metricsHaveTraffic(metrics)),
    cacheRate: formatPercent(metrics.cache_rate, metricsHaveTraffic(metrics)),
    rpm: formatRate(metrics.rpm, metricsHaveTraffic(metrics)),
    tone: healthTone(row?.health?.overall, row?.health?.score),
  }
}

function alignBuckets(coverage, values) {
  const bucketMs = positiveNumber(coverage.bucket_seconds) * 1000
  const start = dateMillis(coverage.requested_start)
  const end = dateMillis(coverage.requested_end) || dateMillis(coverage.data_through)
  if (!bucketMs || !start || !end || start >= end) {
    return values.map(item => ({ tone: bucketTone(item), label: bucketTooltip(item) }))
  }

  const byTime = new Map(
    values.map(item => [dateMillis(item?.bucket_start), item]).filter(([time]) => time),
  )
  const result = []
  for (let cursor = Math.floor(start / bucketMs) * bucketMs; cursor < end; cursor += bucketMs) {
    const item = byTime.get(cursor)
    result.push({
      tone: item ? bucketTone(item) : "muted",
      label: item ? bucketTooltip(item) : "该时段无请求",
    })
  }
  return result
}

function bucketTone(bucket) {
  if (!metricsHaveTraffic(objectValue(bucket?.metrics))) return "muted"
  return healthTone(bucket?.health?.overall, bucket?.health?.score)
}

function bucketTooltip(bucket) {
  const metrics = objectValue(bucket?.metrics)
  return `${bucket?.bucket_start || "未知时间"} · 成功率 ${formatSuccessRate(metrics)} · 首 Token ${formatLatency(metrics.ttft?.p50_ms)}`
}

function matrixLabel(row) {
  return [row?.platform, row?.group_name || (row?.group_id ? `#${row.group_id}` : ""), row?.model]
    .filter(Boolean)
    .map(singleLine)
    .join(" / ")
}

function buildAxis(coverage, timeZone) {
  return {
    start: formatAxisTime(coverage.requested_start, timeZone),
    end: formatAxisTime(coverage.requested_end || coverage.data_through, timeZone),
  }
}

function metricsHaveTraffic(metrics) {
  return [metrics.request_count, metrics.rpm, metrics.tpm].some(value => positiveNumber(value) > 0)
}

function formatSuccessRate(metrics) {
  if (!metricsHaveTraffic(metrics)) return "-"
  const successRate = finiteNumber(metrics.success_rate)
  if (successRate !== null) return `${(successRate * 100).toFixed(1)}%`
  const errorRate = finiteNumber(metrics.error_rate)
  return errorRate === null ? "-" : `${((1 - errorRate) * 100).toFixed(1)}%`
}

function formatPercent(value, hasSamples) {
  const number = finiteNumber(value)
  return hasSamples && number !== null ? `${(number * 100).toFixed(1)}%` : "-"
}

function formatTps(tpm, hasSamples) {
  const number = finiteNumber(tpm)
  return hasSamples && number !== null ? (number / 60).toFixed(1) : "-"
}

function formatRate(value, hasSamples) {
  const number = finiteNumber(value)
  return hasSamples && number !== null ? number.toFixed(1) : "-"
}

function formatLatency(value) {
  const milliseconds = finiteNumber(value)
  if (milliseconds === null) return "-"
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(1)}s`
    : `${Math.round(milliseconds)}ms`
}

function formatLatencyDetail(latency) {
  const value = objectValue(latency)
  const details = []
  if (finiteNumber(value.avg_ms) !== null) details.push(`AVG ${formatLatency(value.avg_ms)}`)
  if (finiteNumber(value.p90_ms) !== null) details.push(`P90 ${formatLatency(value.p90_ms)}`)
  return details.join(" · ") || "暂无延迟分位数据"
}

function overallLabel(health, metrics) {
  if (!metricsHaveTraffic(metrics)) return "暂无请求数据"
  const tone = healthTone(health.overall, health.score)
  if (tone === "success") return "运行健康"
  if (tone === "warning") return "需要关注"
  if (tone === "danger") return "运行异常"
  return "样本不足"
}

function healthTone(state, score) {
  const normalized = String(state || "").toLowerCase()
  if (normalized === "healthy") return "success"
  if (normalized === "warning") return "warning"
  if (normalized === "critical") return "danger"
  const numericScore = finiteNumber(score)
  if (numericScore === null) return "muted"
  if (numericScore < 50) return "danger"
  if (numericScore < 80) return "warning"
  return "success"
}

function coverageLabel(coverage) {
  const bootstrap = objectValue(coverage.bootstrap)
  if (bootstrap.active)
    return `历史数据回填 ${Math.round(finiteNumber(bootstrap.progress_percent) || 0)}%`
  if (coverage.coverage_complete === false) return "历史覆盖不完整"
  return "数据覆盖完整"
}

function formatBucket(value) {
  const seconds = positiveNumber(value)
  if (!seconds) return "时间桶"
  if (seconds < 3600) return `${seconds / 60} 分钟粒度`
  if (seconds < 86400) return `${seconds / 3600} 小时粒度`
  return `${seconds / 86400} 天粒度`
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

function formatAxisTime(value, timeZone) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function dateMillis(value) {
  const milliseconds = new Date(value).getTime()
  return value && Number.isFinite(milliseconds) ? milliseconds : 0
}

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveNumber(value) {
  const number = finiteNumber(value)
  return number !== null && number > 0 ? number : 0
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function singleLine(value) {
  return String(value).replace(/[\r\n]+/g, " ")
}
