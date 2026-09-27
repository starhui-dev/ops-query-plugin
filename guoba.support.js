import { getGuobaConfig, loadConfig, updateConfig } from "./lib/config.js"
import { listCpaQuotaAccountOptions } from "./lib/cpa-quota.js"
import { listNewapiChannelOptions, listNewapiQuotaAccountOptions } from "./lib/newapi-quota.js"
import { selectProxy, withProxy } from "./lib/proxy.js"

const accountOptions = []
const newapiChannelOptions = []
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
      description: "查询账号额度",
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
          bottomHelpMessage: "用于查询 CPA 账号额度；留空保存会保留当前密钥",
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
          label: "NewAPI 配置",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "newapi.baseUrl",
          label: "服务地址",
          bottomHelpMessage: "NewAPI 地址，例如 https://newapi.example.com",
          component: "Input",
          componentProps: { placeholder: "请输入 NewAPI 服务地址" },
        },
        {
          field: "newapi.accessToken",
          label: "访问令牌",
          bottomHelpMessage:
            "NewAPI 个人设置中生成的系统访问令牌，账号需具备渠道读取权限；留空保存会保留当前令牌",
          component: "InputPassword",
          componentProps: { placeholder: "留空表示不修改" },
        },
        {
          field: "newapi.timeoutMs",
          label: "请求超时",
          bottomHelpMessage: "单个 HTTP 请求的超时时间，单位为毫秒",
          component: "InputNumber",
          required: true,
          componentProps: { min: 1000, max: 60000, step: 1000 },
        },
        {
          field: "newapi.channels",
          label: "渠道设置",
          bottomHelpMessage:
            "未添加的渠道默认显示；Kimi / GLM Coding Plan 渠道需填写 API Key 才会查询和显示额度；DeepSeek 渠道填写后改为直连查询实时余额",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            modalProps: { title: "NewAPI 渠道设置" },
            schemas: [
              {
                field: "channelId",
                label: "渠道",
                component: "Select",
                required: true,
                componentProps: {
                  options: newapiChannelOptions,
                  placeholder: "请选择 NewAPI 渠道",
                  showSearch: true,
                  optionFilterProp: "label",
                },
              },
              {
                field: "enabled",
                label: "显示",
                bottomHelpMessage: "关闭后不在 #账号额度 中显示，已配置的额度告警不受影响",
                component: "Switch",
                defaultValue: true,
              },
              {
                field: "apiKey",
                label: "API Key",
                bottomHelpMessage:
                  "Kimi / GLM Coding Plan 渠道必填；DeepSeek 渠道选填，填写后按原始币种显示实时余额。用于直连上游查询，已保存的 Key 不回显，留空保存会保留原值",
                component: "InputPassword",
                componentProps: { placeholder: "留空表示不修改" },
              },
            ],
          },
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
          field: "proxy.newapiEnabled",
          label: "NewAPI 额度查询与告警",
          bottomHelpMessage: "NewAPI 渠道额度、渠道列表、Kimi / GLM 上游额度查询和相关告警走代理",
          component: "Switch",
        },
        {
          field: "proxy.codexRadarEnabled",
          label: "Codex 雷达",
          bottomHelpMessage: "Codex 雷达页面和速览图下载走代理",
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
          bottomHelpMessage: "每隔多少分钟检查一次账号额度",
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
          bottomHelpMessage: "每个有额度信息的 CPA/NewAPI 账号可设置独立的剩余额度阈值",
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
          listCpaQuotaAccountOptions(config.cpa, fetchImpl),
        ),
      )
    }
    if (hasServiceConfig(config.newapi, "accessToken")) {
      queries.push(
        withProxy(selectProxy(config.proxy, "newapi"), fetchImpl =>
          listNewapiQuotaAccountOptions(config.newapi, fetchImpl),
        ),
      )
    }
    const channelQuery = hasServiceConfig(config.newapi, "accessToken")
      ? withProxy(selectProxy(config.proxy, "newapi"), fetchImpl =>
          listNewapiChannelOptions(config.newapi, fetchImpl),
        ).catch(() => [])
      : Promise.resolve([])
    const [settled, channels] = await Promise.all([Promise.allSettled(queries), channelQuery])
    const options = settled.flatMap(result => (result.status === "fulfilled" ? result.value : []))
    accountOptions.splice(0, accountOptions.length, ...options)
    newapiChannelOptions.splice(0, newapiChannelOptions.length, ...channels)
  } catch {
    accountOptions.splice(0, accountOptions.length)
    newapiChannelOptions.splice(0, newapiChannelOptions.length)
  }
}

function hasServiceConfig(config, keyName) {
  return Boolean(config?.baseUrl && config?.[keyName])
}
