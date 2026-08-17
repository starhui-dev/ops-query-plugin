import { loadConfig } from "../lib/config.js"
import { buildS2aImageData, formatS2aForwardNodes, queryS2aMonitors } from "../lib/s2a.js"
import { buildS2aV2ImageData, formatS2aV2ForwardNodes, queryS2aV2Monitor } from "../lib/s2a-v2.js"
import {
  buildS2aQuotaImageData,
  formatS2aQuota,
  queryS2aQuota,
  queryS2aQuotaUsage,
} from "../lib/s2a-quota.js"
import {
  buildS2aSlaAlertImageData,
  evaluateS2aSlaAlert,
  formatS2aSlaAlert,
  formatS2aSlaOverview,
  queryS2aSla,
} from "../lib/s2a-sla.js"
import { checkQueryAccess } from "../lib/access.js"
import {
  buildMentionSegments,
  buildQuotaAlertImageData,
  evaluateQuotaAlerts,
  formatQuotaAlerts,
  parseAlertAccount,
} from "../lib/alerts.js"
import {
  renderChannelsImage,
  renderChannelsV2Image,
  renderSlaAlertImage,
  renderStatusImage,
} from "../lib/render.js"
import { fetchLatestCodexRadarImage } from "../lib/codex-radar.js"
import {
  evaluateCodexResetNotification,
  formatCodexResetNotification,
  formatCodexResetStatus,
  loadCodexResetState,
  queryCodexResetStatus,
  saveCodexResetState,
} from "../lib/codex-resets.js"
import { selectProxy, withProxy } from "../lib/proxy.js"

const quotaAlertStates = new Map()
const slaAlertStates = new Map()
let lastAlertCheckAt = 0

export class OpsQuery extends plugin {
  constructor() {
    super({
      name: "运维查询",
      dsc: "查询 S2A Codex 额度、渠道状态、SLA 和 Codex 重置动态",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#?[Cc][Oo][Dd][Ee][Xx]\\s*(额度|配额)$",
          fnc: "codexQuota",
        },
        {
          reg: "^#?(S2A状态|渠道状态)$",
          fnc: "s2aStatus",
        },
        {
          reg: "^#?(S2A\\s*)?SLA$",
          fnc: "s2aSla",
        },
        {
          reg: "^#?Codex雷达$",
          fnc: "codexRadar",
        },
        {
          reg: "^#?[Cc][Oo][Dd][Ee][Xx]\\s*重置$",
          fnc: "codexReset",
        },
        {
          reg: "^#?运维查询帮助$",
          fnc: "help",
        },
      ],
    })
    this.task = {
      name: "运维告警监控",
      cron: "0 * * * * ?",
      fnc: this.checkAlerts.bind(this),
      log: false,
    }
  }

  async help() {
    if (!(await this.ensureAccess())) return false
    return this.reply(
      [
        "运维查询",
        "#Codex额度：查询 S2A Codex OAuth 账号额度",
        "#S2A状态：查询 S2A 渠道监控",
        "#SLA：查询 Sub2API SLA",
        "#Codex雷达：获取 Codex 雷达最新速览图",
        "#Codex重置：查询最新 Codex 重置公告",
      ].join("\n"),
    )
  }

  async codexQuota() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      const results = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        queryS2aQuota(config.s2a, config.display.timeZone, [], fetchImpl),
      )
      if (!results.length) return this.reply("S2A 中没有可查询的 Codex OAuth 账号")
      const image = await renderStatusImage(
        buildS2aQuotaImageData(results, config.display.timeZone),
        `codex-quota-${Date.now()}`,
        selectProxy(config.proxy, "randomBackground"),
      )
      return this.reply(image || formatS2aQuota(results))
    } catch (error) {
      logger.error(
        `[运维查询] S2A Codex 额度查询失败：${error instanceof Error ? error.stack : error}`,
      )
      return this.reply(`S2A Codex 额度查询失败：${safeError(error)}`)
    }
  }

  async s2aStatus() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      if (config.s2a.monitorVersion === "v2") {
        const report = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
          queryS2aV2Monitor(config.s2a, fetchImpl),
        )
        const image = await renderChannelsV2Image(
          buildS2aV2ImageData(report, config.display.timeZone),
          `s2a-status-v2-${Date.now()}`,
          selectProxy(config.proxy, "randomBackground"),
        )
        if (image) return this.reply(image)
        return this.reply(
          Bot.makeForwardArray(formatS2aV2ForwardNodes(report, config.display.timeZone)),
        )
      }
      const monitors = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        queryS2aMonitors(config.s2a, fetchImpl),
      )
      const image = await renderChannelsImage(
        buildS2aImageData(monitors, config.display.timeZone),
        `s2a-status-${Date.now()}`,
        selectProxy(config.proxy, "randomBackground"),
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

  async s2aSla() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      const timeRange = config.alerts.sla.timeRange
      const overview = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        queryS2aSla(config.s2a, timeRange, fetchImpl),
      )
      return this.reply(formatS2aSlaOverview(overview, timeRange, config.display.timeZone))
    } catch (error) {
      logger.error(`[运维查询] S2A SLA 查询失败：${error instanceof Error ? error.stack : error}`)
      return this.reply(`S2A SLA 查询失败：${safeError(error)}`)
    }
  }

  async codexRadar() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      const image = await fetchLatestCodexRadarImage(selectProxy(config.proxy, "codexRadar"))
      return this.reply(segment.image(image))
    } catch (error) {
      logger.error(
        `[运维查询] Codex 雷达速览图获取失败：${error instanceof Error ? error.stack : error}`,
      )
      return this.reply(`Codex 雷达速览图获取失败：${safeError(error)}`)
    }
  }

  async codexReset() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      const status = await queryCodexResetStatus(selectProxy(config.proxy, "codexResets"))
      return this.reply(formatCodexResetStatus(status, config.display.timeZone))
    } catch (error) {
      logger.error(`[运维查询] Codex 重置查询失败：${error instanceof Error ? error.stack : error}`)
      return this.reply(`Codex 重置查询失败：${safeError(error)}`)
    }
  }

  async ensureAccess() {
    const decision = checkQueryAccess(this.e, loadConfig().access)
    if (decision.allowed) return true
    await this.reply(decision.reason)
    return false
  }

  async checkAlerts() {
    const config = loadConfig()
    if (!config.alerts.enabled) return
    const now = Date.now()
    if (now - lastAlertCheckAt < config.alerts.intervalMinutes * 60000) return
    lastAlertCheckAt = now

    await Promise.all([
      this.checkQuotaAlerts(config),
      this.checkCodexResetAlert(config),
      this.checkSlaAlert(config),
    ])
  }

  async checkQuotaAlerts(config) {
    if (!config.alerts.accounts.length) return
    try {
      const accountIds = config.alerts.accounts
        .map(parseAlertAccount)
        .filter(Boolean)
        .map(account => account.accountId)
      if (!accountIds.length) return
      const results = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        queryS2aQuotaUsage(config.s2a, accountIds, fetchImpl),
      )
      const alerts = evaluateQuotaAlerts(config.alerts.accounts, results, quotaAlertStates)
      if (!alerts.length) return
      const image = await renderStatusImage(
        buildQuotaAlertImageData(alerts, config.display.timeZone),
        `quota-alert-${Date.now()}`,
        selectProxy(config.proxy, "randomBackground"),
      )
      await this.sendAlert(config, image || formatQuotaAlerts(alerts))
    } catch (error) {
      logger.error(
        `[运维查询] S2A Codex 额度监控失败：${error instanceof Error ? error.stack : error}`,
      )
    }
  }

  async checkSlaAlert(config) {
    if (!config.alerts.sla.enabled) return
    try {
      const overview = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        queryS2aSla(config.s2a, config.alerts.sla.timeRange, fetchImpl),
      )
      const alert = evaluateS2aSlaAlert(config.alerts.sla, overview, slaAlertStates)
      if (!alert) return
      const image = await renderSlaAlertImage(
        buildS2aSlaAlertImageData(alert, config.display.timeZone),
        `s2a-sla-alert-${Date.now()}`,
        selectProxy(config.proxy, "randomBackground"),
      )
      await this.sendAlert(config, image || formatS2aSlaAlert(alert))
    } catch (error) {
      logger.error(`[运维查询] S2A SLA 监控失败：${error instanceof Error ? error.stack : error}`)
    }
  }

  async checkCodexResetAlert(config) {
    if (!config.alerts.codexResets.enabled) return
    try {
      const status = await queryCodexResetStatus(selectProxy(config.proxy, "codexResets"))
      const state = loadCodexResetState()
      const decision = evaluateCodexResetNotification(status, state.latestResetId)
      if (!decision.notification) {
        if (decision.latestResetId && decision.latestResetId !== state.latestResetId) {
          saveCodexResetState(decision.latestResetId)
        }
        return
      }

      await this.sendAlert(
        config,
        formatCodexResetNotification(decision.notification, config.display.timeZone),
      )
      saveCodexResetState(decision.latestResetId)
    } catch (error) {
      logger.error(
        `[运维查询] Codex 重置订阅检查失败：${error instanceof Error ? error.stack : error}`,
      )
    }
  }

  async sendAlert(config, content) {
    const message = [...buildMentionSegments(config.alerts), content]
    const whitelist = new Set(config.access.groupWhitelist)
    for (const groupId of config.alerts.targetGroups) {
      if (!whitelist.has(groupId)) continue
      await Bot.pickGroup(groupId).sendMsg(message)
    }
  }
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(Bearer\s+|x-api-key[=:]?\s*)\S+/gi, "$1[已隐藏]")
}
