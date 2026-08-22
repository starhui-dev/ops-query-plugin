import { getGuobaConfig, loadConfig, updateConfig } from "./lib/config.js"
import { listCpaQuotaAccounts } from "./lib/cpa-quota.js"
import { selectProxy, withProxy } from "./lib/proxy.js"
import { listS2aQuotaAccountOptions } from "./lib/s2a-quota.js"

const accountOptions = []
await refreshAccountOptions()

export function supportGuoba() {
  return {
    pluginInfo: {
      name: "ops-query-plugin",
      title: "运维查询",
      author: "@真心",
      authorLink: "https://github.com/RealHeart",
      isV3: true,
      isV2: false,
      showInMenu: true,
      description: "查询账号额度、渠道状态、SLA 和 Codex 重置动态",
      icon: "mdi:server-network",
      iconColor: "#287a6d",
    },
    configInfo: {
      schemas: [
        {
          label: "CPA 配置",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "cpa.baseUrl",
          label: "服务地址",
          bottomHelpMessage: "CLIProxyAPI 地址，例如 https://cpa.example.com",
          component: "Input",
          componentProps: { placeholder: "请输入 CPA 服务地址" },
        },
        {
          field: "cpa.managementKey",
          label: "Management Key",
          bottomHelpMessage: "用于查询 CPA OAuth 账号额度；留空保存会保留当前密钥",
          component: "InputPassword",
          componentProps: { placeholder: "留空表示不修改" },
        },
        {
          field: "cpa.timeoutMs",
          label: "请求超时",
          bottomHelpMessage: "单个 HTTP 请求的超时时间，单位为毫秒",
          component: "InputNumber",
          required: true,
          componentProps: { min: 1000, max: 60000, step: 1000 },
        },
        {
          label: "S2A 配置",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "s2a.baseUrl",
          label: "服务地址",
          bottomHelpMessage: "Sub2API 地址，例如 https://s2a.example.com",
          component: "Input",
          componentProps: { placeholder: "请输入 S2A 服务地址" },
        },
        {
          field: "s2a.adminApiKey",
          label: "Admin API Key",
          bottomHelpMessage: "留空保存会保留当前密钥",
          component: "InputPassword",
          componentProps: { placeholder: "留空表示不修改" },
        },
        {
          field: "s2a.monitorVersion",
          label: "监控版本",
          bottomHelpMessage: "V1 使用主动探测；V2 使用请求统计，需要服务端已切换为 V2 模式",
          component: "Select",
          required: true,
          componentProps: {
            options: [
              { label: "V1 主动探测", value: "v1" },
              { label: "V2 请求统计", value: "v2" },
            ],
          },
        },
        {
          field: "s2a.timeoutMs",
          label: "请求超时",
          bottomHelpMessage: "单个 HTTP 请求的超时时间，单位为毫秒",
          component: "InputNumber",
          required: true,
          componentProps: { min: 1000, max: 60000, step: 1000 },
        },
        {
          label: "代理设置",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "proxy.url",
          label: "代理地址",
          bottomHelpMessage: "支持 HTTP/HTTPS；可包含认证信息，留空保存会保留当前地址",
          component: "InputPassword",
          componentProps: { placeholder: "例如 http://127.0.0.1:7890" },
        },
        {
          field: "proxy.cpaEnabled",
          label: "CPA 额度查询与告警",
          bottomHelpMessage: "CPA OAuth 额度、账号列表和相关告警走代理",
          component: "Switch",
        },
        {
          field: "proxy.s2aEnabled",
          label: "S2A 查询与告警",
          bottomHelpMessage: "S2A Key 额度、渠道状态、SLA、账号列表和相关告警走代理",
          component: "Switch",
        },
        {
          field: "proxy.codexRadarEnabled",
          label: "Codex 雷达",
          bottomHelpMessage: "Codex 雷达页面和速览图下载走代理",
          component: "Switch",
        },
        {
          field: "proxy.codexResetsEnabled",
          label: "Codex 重置",
          bottomHelpMessage: "Codex 重置手动查询和订阅检查走代理",
          component: "Switch",
        },
        {
          field: "proxy.randomBackgroundEnabled",
          label: "随机背景图",
          bottomHelpMessage: "状态图的随机背景下载走代理",
          component: "Switch",
        },
        {
          label: "显示配置",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "display.timeZone",
          label: "显示时区",
          bottomHelpMessage: "用于状态和告警时间，例如 Asia/Shanghai",
          component: "Input",
          required: true,
          componentProps: { placeholder: "Asia/Shanghai" },
        },
        {
          label: "查询权限",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "access.groupWhitelist",
          label: "群聊白名单",
          bottomHelpMessage: "普通用户只能在这些群使用插件；主人不受限制",
          component: "GSelectGroup",
          componentProps: { placeholder: "请选择允许查询的群聊" },
        },
        {
          field: "access.queryUsers",
          label: "可查询人员",
          bottomHelpMessage:
            "填写 QQ 号，无需是好友；留空表示不限制人员，但只在白名单群内响应，私聊不可用",
          component: "GTags",
          componentProps: { allowAdd: true, allowDel: true },
        },
        {
          label: "告警配置",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "alerts.enabled",
          label: "启用告警与订阅",
          component: "Switch",
        },
        {
          field: "alerts.intervalMinutes",
          label: "检查间隔",
          bottomHelpMessage: "每隔多少分钟检查一次账号额度、重置订阅与 Sub2API SLA",
          component: "InputNumber",
          required: true,
          componentProps: { min: 1, max: 1440, step: 1 },
        },
        {
          field: "alerts.targetGroups",
          label: "告警群聊",
          bottomHelpMessage: "目标群必须同时包含在群聊白名单中",
          component: "GSelectGroup",
          componentProps: { placeholder: "请选择接收告警的群聊" },
        },
        {
          field: "alerts.mentionMode",
          label: "提醒方式",
          component: "RadioGroup",
          componentProps: {
            options: [
              { label: "不艾特", value: "none" },
              { label: "指定用户", value: "users" },
              { label: "全体成员", value: "all" },
            ],
          },
        },
        {
          field: "alerts.mentionUsers",
          label: "提醒用户",
          bottomHelpMessage: "提醒方式为“指定用户”时生效",
          component: "GSelectFriend",
          componentProps: { placeholder: "请选择需要艾特的用户" },
        },
        {
          field: "alerts.accounts",
          label: "监控账号",
          bottomHelpMessage: "每个 CPA OAuth 或 S2A Key 账号可设置独立的剩余额度阈值",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            modalProps: { title: "账号额度告警" },
            schemas: [
              {
                field: "account",
                label: "账号",
                component: "Select",
                required: true,
                componentProps: {
                  options: accountOptions,
                  placeholder: "请选择额度账号",
                  showSearch: true,
                  optionFilterProp: "label",
                },
              },
              {
                field: "thresholdPercent",
                label: "告警阈值",
                bottomHelpMessage: "任一额度窗口剩余低于此百分比时告警",
                component: "InputNumber",
                required: true,
                componentProps: { min: 0, max: 100, step: 1, addonAfter: "%" },
              },
            ],
          },
        },
        {
          field: "alerts.codexResets.enabled",
          label: "Codex 重置订阅",
          bottomHelpMessage: "发现新的已确认 Codex 重置公告时推送到告警群聊",
          component: "Switch",
        },
        {
          field: "alerts.sla.enabled",
          label: "SLA 监控",
          bottomHelpMessage: "监控 Sub2API Ops SLA；业务限制类错误不会计入异常",
          component: "Switch",
        },
        {
          field: "alerts.sla.timeRange",
          label: "SLA 统计窗口",
          component: "Select",
          required: true,
          componentProps: {
            options: [
              { label: "近 5 分钟", value: "5m" },
              { label: "近 30 分钟", value: "30m" },
              { label: "近 1 小时", value: "1h" },
              { label: "近 6 小时", value: "6h" },
              { label: "近 24 小时", value: "24h" },
            ],
          },
        },
        {
          field: "alerts.sla.thresholdPercent",
          label: "SLA 告警阈值",
          bottomHelpMessage: "排除业务限制后的 SLA 低于此值时告警",
          component: "InputNumber",
          required: true,
          componentProps: { min: 0, max: 100, step: 0.001, addonAfter: "%" },
        },
      ],
      getConfigData() {
        return getGuobaConfig()
      },
      async setConfigData(data, { Result }) {
        try {
          const config = updateConfig(data)
          await refreshAccountOptions(config)
          return Result.ok({}, "保存成功")
        } catch (error) {
          return Result.error(error instanceof Error ? error.message : String(error))
        }
      },
    },
  }
}

async function refreshAccountOptions(config = loadConfig()) {
  try {
    const queries = []
    if (hasServiceConfig(config.cpa, "managementKey")) {
      queries.push(
        withProxy(selectProxy(config.proxy, "cpa"), fetchImpl =>
          listCpaQuotaAccounts(config.cpa, fetchImpl),
        ),
      )
    }
    if (hasServiceConfig(config.s2a, "adminApiKey")) {
      queries.push(
        withProxy(selectProxy(config.proxy, "s2a"), fetchImpl =>
          listS2aQuotaAccountOptions(config.s2a, fetchImpl),
        ),
      )
    }
    const settled = await Promise.allSettled(queries)
    const options = settled.flatMap(result => (result.status === "fulfilled" ? result.value : []))
    accountOptions.splice(0, accountOptions.length, ...options)
  } catch {
    accountOptions.splice(0, accountOptions.length)
  }
}

function hasServiceConfig(config, keyName) {
  return Boolean(config?.baseUrl && config?.[keyName])
}
