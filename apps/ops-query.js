import { loadConfig } from "../lib/config.js"
import { OPS_QUERY_RULES } from "../lib/commands.js"
import { queryCpaQuota } from "../lib/cpa-quota.js"
import { queryNewapiQuota } from "../lib/newapi-quota.js"
import { buildAccountQuotaImageData, formatAccountQuota } from "../lib/account-quota.js"
import { checkQueryAccess } from "../lib/access.js"
import {
  buildMentionSegments,
  buildQuotaAlertImageData,
  evaluateQuotaAlerts,
  formatQuotaAlerts,
  parseAlertAccount,
} from "../lib/alerts.js"
import { renderStatusImage } from "../lib/render.js"
import { fetchLatestCodexRadarImage } from "../lib/codex-radar.js"
import { selectProxy, withProxy } from "../lib/proxy.js"

const quotaAlertStates = new Map()
let lastAlertCheckAt = 0

export class OpsQuery extends plugin {
  constructor() {
    super({
      name: "运维查询",
      dsc: "查询账号额度",
      event: "message",
      priority: 5000,
      rule: OPS_QUERY_RULES,
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
        "#账号额度：查询 CPA 与 NewAPI 账号额度",
        "#Codex雷达：获取 Codex 雷达最新速览图",
      ].join("\n"),
    )
  }

  async accountQuota() {
    if (!(await this.ensureAccess())) return false
    try {
      const config = loadConfig()
      const results = await queryAccountQuotaResults(config)
      if (!results.length) return this.reply("没有可查询额度的账号")
      const image = await renderStatusImage(
        buildAccountQuotaImageData(results, config.display.timeZone),
        `account-quota-${Date.now()}`,
        selectProxy(config.proxy, "randomBackground"),
      )
      return this.reply(image || formatAccountQuota(results))
    } catch (error) {
      logger.error(`[运维查询] 账号额度查询失败：${error instanceof Error ? error.stack : error}`)
      return this.reply(`账号额度查询失败：${safeError(error)}`)
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

    await this.checkQuotaAlerts(config)
  }

  async checkQuotaAlerts(config) {
    if (!config.alerts.accounts.length) return
    try {
      const accounts = config.alerts.accounts.map(parseAlertAccount).filter(Boolean)
      if (!accounts.length) return
      const results = await queryAccountQuotaResults(config, accounts)
      const alerts = evaluateQuotaAlerts(config.alerts.accounts, results, quotaAlertStates)
      if (!alerts.length) return
      const image = await renderStatusImage(
        buildQuotaAlertImageData(alerts, config.display.timeZone),
        `quota-alert-${Date.now()}`,
        selectProxy(config.proxy, "randomBackground"),
      )
      await this.sendAlert(config, image || formatQuotaAlerts(alerts))
    } catch (error) {
      logger.error(`[运维查询] 账号额度监控失败：${error instanceof Error ? error.stack : error}`)
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

async function queryAccountQuotaResults(config, accounts = null) {
  const allAccounts = accounts === null
  const cpaAccounts = allAccounts ? [] : accounts.filter(account => account.source === "cpa")
  const newapiChannelIds = allAccounts
    ? []
    : accounts.filter(account => account.source === "newapi").map(account => account.accountId)
  const queries = []

  if ((allAccounts && hasServiceConfig(config.cpa, "managementKey")) || cpaAccounts.length) {
    queries.push(
      withProxy(selectProxy(config.proxy, "cpa"), fetchImpl =>
        queryCpaQuota(config.cpa, config.display.timeZone, cpaAccounts, fetchImpl),
      ),
    )
  }
  if ((allAccounts && hasServiceConfig(config.newapi, "accessToken")) || newapiChannelIds.length) {
    queries.push(
      withProxy(selectProxy(config.proxy, "newapi"), fetchImpl =>
        // 显示开关只影响 #账号额度，已配置的告警账号即使关闭显示也照常检查。
        queryNewapiQuota(config.newapi, config.display.timeZone, newapiChannelIds, fetchImpl, {
          respectDisplay: allAccounts,
        }),
      ),
    )
  }
  if (!queries.length) throw new Error("CPA 或 NewAPI 尚未配置服务地址和密钥")

  return (await Promise.all(queries)).flat()
}

function hasServiceConfig(config, keyName) {
  return Boolean(config?.baseUrl && config?.[keyName])
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(Bearer\s+|x-api-key[=:]?\s*)\S+/gi, "$1[已隐藏]")
}
