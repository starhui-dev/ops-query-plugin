import { loadConfig } from "../lib/config.js"
import { OPS_QUERY_RULES } from "../lib/commands.js"
import { queryCpaQuota } from "../lib/cpa-quota.js"
import { buildS2aImageData, formatS2aForwardNodes, queryS2aMonitors } from "../lib/s2a.js"
import { buildS2aV2ImageData, formatS2aV2ForwardNodes, queryS2aV2Monitor } from "../lib/s2a-v2.js"
import { buildAccountQuotaImageData, formatAccountQuota, queryS2aQuota } from "../lib/s2a-quota.js"
import {
  buildS2aSlaAlertImageData,
  evaluateS2aSlaAlert,
  formatS2aSlaAlert,
  formatS2aSlaOverview,
  queryS2aSla,
} from "../lib/s2a-sla.js"
import { checkGroupAccess, checkQueryAccess } from "../lib/access.js"
import { isBalanceAdmin } from "../lib/balance-access.js"
import {
  bindAccount as saveBinding,
  createBalanceRequest,
  findRequest,
  findBindingByEmail,
  findBindingByAccount,
  getBinding,
  hasPendingRequest,
  loadBalanceRequestState,
  markRequestApproved,
  markRequestApproving,
  markRequestRejected,
  resetRequestToPending,
  saveBalanceRequestState,
  setRequestMessageId,
} from "../lib/balance-requests.js"
import {
  consumeEmailVerification,
  createEmailVerification,
  maskEmail,
  removeEmailVerification,
  sendVerificationEmail,
  verifyEmailCode,
} from "../lib/email-verification.js"
import {
  addS2aUserBalance,
  assertBalanceRequestEligible,
  getS2aUser,
  getS2aUserByEmail,
  parsePositiveAmount,
} from "../lib/s2a-balance.js"
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
      dsc: "查询账号额度、渠道状态、SLA 和 Codex 重置动态",
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
        "#账号额度：查询 CPA OAuth 与 S2A Key 账号额度",
        "#渠道状态：查询 S2A 渠道监控",
        "#SLA：查询 Sub2API SLA",
        "#Codex雷达：获取 Codex 雷达最新速览图",
        "#Codex重置：查询最新 Codex 重置公告",
        "#S2A绑定 <邮箱>：发送邮箱验证码，验证后直接绑定 S2A 账号",
        "#S2A验证码 <6位数字>：验证邮箱并完成绑定",
        "#S2A余额：查询已绑定 S2A 邮箱的当前余额",
        "#S2A申请余额 <金额>：提交余额增加申请",
        "机器人主人或配置的审批人员可回复申请消息 #S2A通过 或 #S2A拒绝",
      ].join("\n"),
    )
  }

  async bindAccount() {
    const config = loadConfig()
    if (!(await this.ensureBalanceAccess(config))) return false
    const argument = commandArgument(this.e, "S2A绑定")
    if (!argument) return this.reply("用法：#S2A绑定 <邮箱>\n然后发送 #S2A验证码 <6位数字>")

    if (!config.balanceRequests.emailVerification.enabled) {
      return this.reply("邮箱验证码功能未启用，请联系管理员配置 SMTP")
    }

    const email = argument.split(/\s+/)[0].trim().toLowerCase()
    const groupId = String(this.e.group_id)
    const userId = String(this.e.user_id)
    const state = loadBalanceRequestState()
    const binding = getBinding(state, groupId, userId)
    if (binding?.email === email) {
      return this.reply(`你已绑定邮箱 ${maskEmail(email)}`)
    }
    let s2aUser
    try {
      s2aUser = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        getS2aUserByEmail(config.s2a, email, fetchImpl),
      )
    } catch (error) {
      return this.reply(`S2A 邮箱校验失败：${safeError(error)}`)
    }

    const accountBinding =
      findBindingByEmail(state, email) || findBindingByAccount(state, s2aUser.id)
    if (
      accountBinding &&
      (accountBinding.groupId !== groupId || accountBinding.userId !== userId)
    ) {
      return this.reply("该 S2A 邮箱已绑定其他群成员，如需更换请联系管理员")
    }

    try {
      const { code } = createEmailVerification(state, {
        groupId,
        userId,
        email,
        applicantName: displayApplicant(this.e),
        sourceMessageId: this.e.message_id,
      })
      await sendVerificationEmail(config.balanceRequests.emailVerification, email, code)
      saveBalanceRequestState(state)
    } catch (error) {
      removeEmailVerification(state, groupId, userId)
      return this.reply(`验证码发送失败：${safeError(error)}`)
    }
    return this.reply(
      `验证码已发送到 ${maskEmail(email)}，10 分钟内有效。请发送 #S2A验证码 <6位数字>`,
    )
  }

  async verifyEmailCode() {
    const config = loadConfig()
    if (!(await this.ensureBalanceAccess(config))) return false
    const argument = commandArgument(this.e, "S2A验证码")
    if (!argument) return this.reply("用法：#S2A验证码 <6位数字>")

    const groupId = String(this.e.group_id)
    const userId = String(this.e.user_id)
    const state = loadBalanceRequestState()
    const result = verifyEmailCode(state, groupId, userId, argument.split(/\s+/)[0])
    if (!result.ok) {
      saveBalanceRequestState(state)
      return this.reply(result.message)
    }
    const verification = result.verification
    const accountBinding = findBindingByEmail(state, verification.email)
    if (
      accountBinding &&
      (accountBinding.groupId !== groupId || accountBinding.userId !== userId)
    ) {
      consumeEmailVerification(state, groupId, userId, verification)
      saveBalanceRequestState(state)
      return this.reply("该 S2A 邮箱已绑定其他群成员，如需更换请联系管理员")
    }
    saveBinding(state, {
      groupId,
      userId,
      email: verification.email,
      approvedBy: "email-verification",
    })
    consumeEmailVerification(state, groupId, userId, verification)
    saveBalanceRequestState(state)
    return this.reply(
      `邮箱验证成功，已绑定 ${maskEmail(verification.email)}。现在可以使用 #S2A余额 查询余额或使用 #S2A申请余额 申请增加余额`,
    )
  }

  async queryBalance() {
    const config = loadConfig()
    if (!(await this.ensureBalanceAccess(config))) return false

    const groupId = String(this.e.group_id)
    const userId = String(this.e.user_id)
    const state = loadBalanceRequestState()
    const binding = getBinding(state, groupId, userId)
    if (!binding?.email) {
      return this.reply("你还没有绑定 S2A 邮箱，请先使用 #S2A绑定 <邮箱> 完成验证")
    }

    try {
      const user = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        getS2aUserByEmail(config.s2a, binding.email, fetchImpl),
      )
      const balance = Number(user.balance)
      if (!Number.isFinite(balance)) throw new Error("S2A 返回的余额无效")
      return this.reply(`S2A 邮箱 ${maskEmail(binding.email)} 当前余额：${formatBalance(balance)}`)
    } catch (error) {
      return this.reply(`S2A 余额查询失败：${safeError(error)}`)
    }
  }

  async requestBalance() {
    const config = loadConfig()
    if (!(await this.ensureBalanceAccess(config))) return false
    const argument = commandArgument(this.e, "S2A申请余额")
    if (!argument) return this.reply("用法：#S2A申请余额 <金额> [备注]")

    const [rawAmount, ...reasonParts] = argument.split(/\s+/)
    let amount
    try {
      amount = parsePositiveAmount(rawAmount)
    } catch (error) {
      return this.reply(error.message)
    }
    if (amount > config.balanceRequests.maxAmount) {
      return this.reply(`单笔余额申请不能超过 ${config.balanceRequests.maxAmount}`)
    }

    const groupId = String(this.e.group_id)
    const userId = String(this.e.user_id)
    const state = loadBalanceRequestState()
    const binding = getBinding(state, groupId, userId)
    if (!binding?.email) {
      return this.reply("你还没有绑定 S2A 邮箱，请先使用 #S2A绑定 <邮箱> 完成验证")
    }
    if (hasPendingRequest(state, groupId, userId, "balance")) {
      return this.reply("你已有待审批的余额申请，请等待管理员处理")
    }

    let s2aUser
    try {
      s2aUser = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        getS2aUserByEmail(config.s2a, binding.email, fetchImpl),
      )
      assertBalanceRequestEligible(s2aUser)
    } catch (error) {
      return this.reply(`余额申请资格校验失败：${safeError(error)}`)
    }

    const request = createBalanceRequest(state, {
      groupId,
      userId,
      email: binding.email,
      amount,
      reason: reasonParts.join(" ").slice(0, 200),
      applicantName: displayApplicant(this.e),
      sourceMessageId: this.e.message_id,
    })
    saveBalanceRequestState(state)
    const sent = await this.reply(
      [
        `余额申请 ${request.id}`,
        `申请人：${displayApplicant(this.e)}（QQ ${userId}）`,
        `S2A 邮箱：${maskEmail(binding.email)}`,
        `申请增加：${amount}`,
        request.reason ? `备注：${request.reason}` : "",
        "机器人主人或配置的审批人员请直接回复本消息 #S2A通过 或 #S2A拒绝",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    const messageId = extractMessageId(sent)
    if (messageId) {
      setRequestMessageId(state, request.id, messageId)
      saveBalanceRequestState(state)
    }
    return true
  }

  async approveBalanceRequest() {
    return this.decideBalanceRequest(true)
  }

  async rejectBalanceRequest() {
    return this.decideBalanceRequest(false)
  }

  async decideBalanceRequest(approved) {
    const config = loadConfig()
    if (!(await this.ensureBalanceAccess(config))) return false
    if (!(await isBalanceAdmin(this.e, config.balanceRequests.adminUsers))) {
      return this.reply("只有机器人主人或配置的审批人员可以审批余额申请")
    }

    const argument = commandArgument(this.e, approved ? "S2A通过" : "S2A拒绝")
    const state = loadBalanceRequestState()
    const target = await replyTargetInfo(this.e)
    const request = findRequest(state, {
      requestId: argument.split(/\s+/)[0],
      messageId: target.messageId,
      text: target.text,
      groupId: String(this.e.group_id),
    })
    if (!request) {
      return this.reply(
        approved
          ? "未找到待审批申请，请直接回复申请消息 #S2A通过，或使用 #S2A通过 <申请编号>"
          : "未找到待审批申请，请直接回复申请消息 #S2A拒绝，或使用 #S2A拒绝 <申请编号>",
      )
    }
    if (request.status === "approving") {
      return this.reply(`申请 ${request.id} 正在处理中，请勿重复审批`)
    }
    if (request.status !== "pending") {
      return this.reply(`申请 ${request.id} 已${request.status === "approved" ? "通过" : "拒绝"}`)
    }

    if (!approved) {
      markRequestRejected(
        state,
        request.id,
        String(this.e.user_id),
        argument.split(/\s+/).slice(1).join(" "),
      )
      saveBalanceRequestState(state)
      await notifyApplicant(
        request,
        `申请 ${request.id} 已被拒绝${request.reason ? `：${request.reason}` : ""}`,
      )
      return this.reply(`已拒绝申请 ${request.id}`)
    }

    markRequestApproving(state, request.id, String(this.e.user_id))
    saveBalanceRequestState(state)
    try {
      if (request.kind === "binding") {
        const s2aUser = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
          request.email
            ? getS2aUserByEmail(config.s2a, request.email, fetchImpl)
            : getS2aUser(config.s2a, request.accountId, fetchImpl),
        )
        request.email = String(s2aUser.email || request.email || "")
          .trim()
          .toLowerCase()
        if (!request.email) throw new Error("S2A 用户资料缺少邮箱，无法完成绑定")
        const accountBinding =
          findBindingByEmail(state, request.email) || findBindingByAccount(state, s2aUser.id)
        if (
          accountBinding &&
          (accountBinding.groupId !== request.groupId || accountBinding.userId !== request.userId)
        ) {
          throw new Error("该 S2A 邮箱已绑定其他群成员")
        }
        saveBinding(state, {
          groupId: request.groupId,
          userId: request.userId,
          email: request.email,
          approvedBy: String(this.e.user_id),
        })
      } else {
        const s2aUser = await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
          request.email
            ? getS2aUserByEmail(config.s2a, request.email, fetchImpl)
            : getS2aUser(config.s2a, request.accountId, fetchImpl),
        )
        request.email = String(s2aUser.email || request.email || "")
          .trim()
          .toLowerCase()
        await withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
          addS2aUserBalance(
            config.s2a,
            s2aUser.id,
            request.amount,
            `群聊余额申请 ${request.id}（QQ ${request.userId}）`,
            fetchImpl,
            request.id,
          ),
        )
      }
      markRequestApproved(state, request.id, String(this.e.user_id))
      saveBalanceRequestState(state)
      const result =
        request.kind === "binding"
          ? `已通过绑定申请 ${request.id}，QQ ${request.userId} 已绑定邮箱 ${maskEmail(request.email)}`
          : `已通过申请 ${request.id}，S2A 邮箱 ${maskEmail(request.email)} 已增加余额 ${request.amount}`
      await notifyApplicant(request, result)
      return this.reply(result)
    } catch (error) {
      resetRequestToPending(state, request.id, safeError(error))
      saveBalanceRequestState(state)
      return this.reply(`处理申请 ${request.id} 失败，申请仍保持待审批：${safeError(error)}`)
    }
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

  async channelStatus() {
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
      return this.reply(`渠道状态查询失败：${safeError(error)}`)
    }
  }

  async sla() {
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

  async ensureBalanceAccess(config) {
    if (!config.balanceRequests.enabled) {
      await this.reply("余额申请功能未启用")
      return false
    }
    const decision = checkGroupAccess(this.e, config.access)
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

async function queryAccountQuotaResults(config, accounts = null) {
  const allAccounts = accounts === null
  const cpaAccounts = allAccounts ? [] : accounts.filter(account => account.source === "cpa")
  const s2aAccounts = allAccounts ? [] : accounts.filter(account => account.source === "s2a")
  const s2aAccountIds = s2aAccounts.map(account => account.accountId)
  const queries = []

  if ((allAccounts && hasServiceConfig(config.cpa, "managementKey")) || cpaAccounts.length) {
    queries.push(
      withProxy(selectProxy(config.proxy, "cpa"), fetchImpl =>
        queryCpaQuota(config.cpa, config.display.timeZone, cpaAccounts, fetchImpl),
      ),
    )
  }
  if ((allAccounts && hasServiceConfig(config.s2a, "adminApiKey")) || s2aAccountIds.length) {
    queries.push(
      withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
        queryS2aQuota(config.s2a, config.display.timeZone, s2aAccountIds, fetchImpl),
      ),
    )
  }
  if (!queries.length) throw new Error("CPA 或 S2A 尚未配置服务地址和密钥")

  return (await Promise.all(queries)).flat()
}

function hasServiceConfig(config, keyName) {
  return Boolean(config?.baseUrl && config?.[keyName])
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(Bearer\s+|x-api-key[=:]?\s*)\S+/gi, "$1[已隐藏]")
}

function formatBalance(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "")
}

function commandArgument(event, command) {
  const text = eventText(event).trim()
  const match = text.match(new RegExp(`^#?${command}(?:\\s+([\\s\\S]*))?$`))
  return match?.[1]?.trim() || ""
}

function eventText(event) {
  if (typeof event?.msg === "string") return event.msg
  if (typeof event?.raw_message === "string") return event.raw_message
  if (typeof event?.message === "string") return event.message
  if (Array.isArray(event?.message)) {
    return event.message
      .map(item => (typeof item === "string" ? item : item?.type === "text" ? item.text : ""))
      .join("")
  }
  return ""
}

function displayApplicant(event) {
  const sender = event?.sender || event?.member || {}
  return String(sender.card || sender.nickname || sender.name || event?.user_id || "未知用户")
    .replace(/[\r\n]/g, " ")
    .slice(0, 80)
}

async function replyTargetInfo(event) {
  const candidates = [
    event?.reply_id,
    event?.source?.message_id,
    event?.source?.id,
    event?.source?.seq,
  ]
  const replySegment = Array.isArray(event?.message)
    ? event.message.find(item => item?.type === "reply")
    : null
  candidates.push(replySegment?.data?.id, replySegment?.data?.message_id, replySegment?.data?.seq)
  const direct = candidates.find(Boolean)
  if (direct) return { messageId: String(direct), text: "" }
  if (typeof event?.getReply === "function") {
    try {
      const reply = await event.getReply()
      return { messageId: extractMessageId(reply), text: eventText(reply) }
    } catch {
      return { messageId: "", text: "" }
    }
  }
  return { messageId: "", text: "" }
}

function extractMessageId(value) {
  if (!value) return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractMessageId(item)
      if (id) return id
    }
    return ""
  }
  return String(
    value.message_id ||
      value.messageId ||
      value.id ||
      value.seq ||
      extractMessageId(value.data) ||
      "",
  )
}

async function notifyApplicant(request, message) {
  try {
    const group = globalThis.Bot?.pickGroup?.(request.groupId)
    if (!group?.sendMsg) return
    await group.sendMsg(`@${request.userId} ${message}`)
  } catch (error) {
    globalThis.logger?.warn?.(
      `[运维查询] 余额申请结果通知失败：${error instanceof Error ? error.message : error}`,
    )
  }
}
