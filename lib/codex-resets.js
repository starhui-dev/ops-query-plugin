import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { requestJson } from "./http.js"
import { withProxy } from "./proxy.js"

const CODEX_RESETS_STATUS_URL = "https://codex-resets.com/api/v1/status"
const REQUEST_TIMEOUT_MS = 10000
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const codexResetStatePath = path.join(pluginRoot, "data", "codex-resets.json")

export async function queryCodexResetStatus(proxy = {}, fetchImpl) {
  return withProxy(
    proxy,
    async requestFetch => {
      const response = await requestJson(
        CODEX_RESETS_STATUS_URL,
        { headers: { "User-Agent": "ops-query-plugin/0.1" } },
        REQUEST_TIMEOUT_MS,
        requestFetch,
      )
      return parseCodexResetStatus(response)
    },
    fetchImpl,
  )
}

export function parseCodexResetStatus(response) {
  const data = response?.data
  if (!data || typeof data !== "object") throw invalidResponse()

  return {
    latestReset: data.latest_reset === null ? null : parseReset(data.latest_reset),
    activeWatch: data.active_watch === null ? null : parseWatch(data.active_watch),
    stats: parseStats(data.stats),
  }
}

export function evaluateCodexResetNotification(status, lastResetId) {
  const latestReset = status?.latestReset
  if (!latestReset) return { latestResetId: lastResetId || null, notification: null }
  if (!lastResetId) return { latestResetId: latestReset.id, notification: null }

  const comparison = comparePostIds(latestReset.id, lastResetId)
  if (comparison <= 0) return { latestResetId: lastResetId, notification: null }
  return { latestResetId: latestReset.id, notification: latestReset }
}

export function formatCodexResetStatus(status, timeZone = "Asia/Shanghai") {
  const lines = ["Codex 重置动态"]
  if (status.latestReset) {
    lines.push(
      `最近重置  ${formatDateTime(status.latestReset.announcedAt, timeZone)}`,
      `累计记录  ${status.stats.total} 次`,
      "",
      status.latestReset.text,
      "",
      `来源：@${status.latestReset.source.author}`,
      `原帖：${status.latestReset.source.url}`,
    )
  } else {
    lines.push("暂无已确认的重置公告")
  }

  lines.push("", "重置观察（AI 预测，非官方承诺）")
  if (!status.activeWatch) {
    lines.push("当前没有活跃预测")
    return lines.join("\n")
  }

  const watch = status.activeWatch
  lines.push(
    `级别      ${watch.level === "strong" ? "强烈" : "升高"}`,
    `重置概率  ${watch.resetChancePercent === null ? "-" : `${watch.resetChancePercent}%`}`,
    `预测窗口  ${watch.forecastWindow}`,
    `有效期至  ${formatDateTime(watch.expiresAt, timeZone)}`,
    "",
    watch.text,
  )
  return lines.join("\n")
}

export function formatCodexResetNotification(reset, timeZone = "Asia/Shanghai") {
  return [
    "Codex 额度重置通知",
    `公告时间  ${formatDateTime(reset.announcedAt, timeZone)}`,
    "",
    reset.text,
    "",
    `来源：@${reset.source.author}`,
    `原帖：${reset.source.url}`,
  ].join("\n")
}

export function loadCodexResetState(file = codexResetStatePath) {
  if (!fs.existsSync(file)) return { latestResetId: null }
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"))
    return { latestResetId: isPostId(state?.latestResetId) ? state.latestResetId : null }
  } catch (error) {
    throw new Error(`Codex 重置订阅状态读取失败：${error.message}`)
  }
}

export function saveCodexResetState(latestResetId, file = codexResetStatePath) {
  if (!isPostId(latestResetId)) throw new Error("Codex 重置订阅状态无效")
  const temporary = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temporary, `${JSON.stringify({ latestResetId }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o600)
  } catch (error) {
    throw new Error(`Codex 重置订阅状态保存失败：${error.message}`)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function parseReset(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !isPostId(value.id) ||
    !isDateTime(value.announced_at) ||
    typeof value.text !== "string" ||
    !value.source ||
    typeof value.source.author !== "string" ||
    !isHttpUrl(value.source.url)
  ) {
    throw invalidResponse()
  }
  return {
    id: value.id,
    announcedAt: value.announced_at,
    text: value.text.trim(),
    source: { author: value.source.author, url: value.source.url },
  }
}

function parseWatch(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !["elevated", "strong"].includes(value.level) ||
    !isNullablePercentage(value.reset_chance_percent) ||
    typeof value.forecast_window !== "string" ||
    !isDateTime(value.expires_at) ||
    typeof value.text !== "string"
  ) {
    throw invalidResponse()
  }
  return {
    level: value.level,
    resetChancePercent: value.reset_chance_percent,
    forecastWindow: value.forecast_window,
    expiresAt: value.expires_at,
    text: value.text.trim(),
  }
}

function parseStats(value) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.total) || value.total < 0) {
    throw invalidResponse()
  }
  return { total: value.total }
}

function comparePostIds(left, right) {
  if (!isPostId(left) || !isPostId(right)) return 0
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId === rightId ? 0 : leftId > rightId ? 1 : -1
}

function isPostId(value) {
  return typeof value === "string" && /^\d{1,32}$/.test(value)
}

function isDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function isNullablePercentage(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 100)
}

function invalidResponse() {
  return new Error("Codex Resets 接口响应结构异常")
}

function formatDateTime(value, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}
