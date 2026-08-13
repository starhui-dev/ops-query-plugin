import { loadConfig } from "../lib/config.js"
import {
  buildCpaQuotaImageData,
  buildCpaStatusImageData,
  formatCpaQuota,
  formatCpaStatus,
  queryCpaQuota,
  queryCpaStatus,
} from "../lib/cpa.js"
import { buildS2aImageData, formatS2aForwardNodes, queryS2aMonitors } from "../lib/s2a.js"
import { buildS2aV2ImageData, formatS2aV2ForwardNodes, queryS2aV2Monitor } from "../lib/s2a-v2.js"
import { checkQueryAccess } from "../lib/access.js"
import {
  buildQuotaAlertImageData,
  buildMentionSegments,
  evaluateQuotaAlerts,
  formatQuotaAlerts,
  parseAlertAccount,
} from "../lib/alerts.js"
import { renderChannelsImage, renderChannelsV2Image, renderStatusImage } from "../lib/render.js"
import { fetchLatestCodexRadarImage } from "../lib/codex-radar.js"

const alertStates = new Map()
let lastAlertCheckAt = 0

export class OpsQuery extends plugin {
  constructor() {
    super({
      name: "运维查询",
      dsc: "查询 CPA Codex 额度和 S2A 渠道状态",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#?(Codex|CPA\\s*Codex)(额度|配额)$",
          fnc: "cpaQuota",
        },
        {
          reg: "^#?CPA状态$",
          fnc: "cpaStatus",
        },
        {
          reg: "^#?(S2A状态|渠道状态)$",
          fnc: "s2aStatus",
        },
        {
          reg: "^#?Codex雷达$",
          fnc: "codexRadar",
        },
        {
          reg: "^#?运维查询帮助$",
          fnc: "help",
        },
      ],
    })
    this.task = {
      name: "CPA 额度监控",
      cron: "0 * * * * ?",
      fnc: this.checkQuotaAlerts.bind(this),
      log: false,
    }
  }

  async help() {
    if (!(await this.ensureAccess())) return false
    return this.reply(
      [
        "运维查询",
        "#Codex额度：查询 CPA Codex 账号额度",
        "#CPA状态：查询 CPA 全部提供商凭据状态",
        "#S2A状态：查询 S2A 渠道监控",
        "#Codex雷达：获取 Codex 雷达最新速览图",
      ].join("\n"),
    )
  }

  async cpaStatus() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      const report = await queryCpaStatus(config.cpa)
      const image = await renderStatusImage(
        buildCpaStatusImageData(report, config.display.timeZone),
        `cpa-status-${Date.now()}`,
      )
      return this.reply(image || formatCpaStatus(report))
    } catch (error) {
      logger.error(`[运维查询] CPA 状态查询失败：${error instanceof Error ? error.stack : error}`)
      return this.reply(`CPA 状态查询失败：${safeError(error)}`)
    }
  }

  async cpaQuota() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      const results = await queryCpaQuota(config.cpa, config.display.timeZone)
      if (!results.length) return this.reply("CPA 中没有可查询的 Codex 账号")
      const image = await renderStatusImage(
        buildCpaQuotaImageData(results, config.display.timeZone),
        `codex-quota-${Date.now()}`,
      )
      return this.reply(image || formatCpaQuota(results))
    } catch (error) {
      logger.error(`[运维查询] CPA 查询失败：${error instanceof Error ? error.stack : error}`)
      return this.reply(`CPA 查询失败：${safeError(error)}`)
    }
  }

  async s2aStatus() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      if (config.s2a.monitorVersion === "v2") {
        const report = await queryS2aV2Monitor(config.s2a)
        const image = await renderChannelsV2Image(
          buildS2aV2ImageData(report, config.display.timeZone),
          `s2a-status-v2-${Date.now()}`,
        )
        if (image) return this.reply(image)
        return this.reply(
          Bot.makeForwardArray(formatS2aV2ForwardNodes(report, config.display.timeZone)),
        )
      }
      const monitors = await queryS2aMonitors(config.s2a)
      const image = await renderChannelsImage(
        buildS2aImageData(monitors, config.display.timeZone),
        `s2a-status-${Date.now()}`,
      )
      if (image) return this.reply(image)
      return this.reply(
        Bot.makeForwardArray(formatS2aForwardNodes(monitors, config.display.timeZone)),
      )
    } catch (error) {
      logger.error(`[运维查询] S2A 查询失败：${error instanceof Error ? error.stack : error}`)
      return this.reply(`S2A 查询失败：${safeError(error)}`)
    }
  }

  async codexRadar() {
    if (!(await this.ensureAccess())) return false
    try {
      const image = await fetchLatestCodexRadarImage()
      return this.reply(segment.image(image))
    } catch (error) {
      logger.error(
        `[运维查询] Codex 雷达速览图获取失败：${error instanceof Error ? error.stack : error}`,
      )
      return this.reply(`Codex 雷达速览图获取失败：${safeError(error)}`)
    }
  }

  async ensureAccess() {
    const decision = checkQueryAccess(this.e, loadConfig().access)
    if (decision.allowed) return true
    await this.reply(decision.reason)
    return false
  }

  async checkQuotaAlerts() {
    const config = loadConfig()
    if (!config.alerts.enabled) return
    const now = Date.now()
    if (now - lastAlertCheckAt < config.alerts.intervalMinutes * 60000) return
    lastAlertCheckAt = now

    try {
      const authIndexes = config.alerts.accounts
        .map(parseAlertAccount)
        .filter(Boolean)
        .map(account => account.authIndex)
      if (!authIndexes.length) return
      const results = await queryCpaQuota(config.cpa, config.display.timeZone, authIndexes)

      const alerts = evaluateQuotaAlerts(config.alerts.accounts, results, alertStates)
      if (!alerts.length) return
      const image = await renderStatusImage(
        buildQuotaAlertImageData(alerts, config.display.timeZone),
        `quota-alert-${Date.now()}`,
      )
      const message = [...buildMentionSegments(config.alerts), image || formatQuotaAlerts(alerts)]
      const whitelist = new Set(config.access.groupWhitelist)
      for (const groupId of config.alerts.targetGroups) {
        if (!whitelist.has(groupId)) continue
        await Bot.pickGroup(groupId).sendMsg(message)
      }
    } catch (error) {
      logger.error(`[运维查询] CPA 额度监控失败：${error instanceof Error ? error.stack : error}`)
    }
  }
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(Bearer\s+|x-api-key[=:]?\s*)\S+/gi, "$1[已隐藏]")
}
