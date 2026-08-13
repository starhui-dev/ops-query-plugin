import { getGuobaConfig, loadConfig, updateConfig } from "./lib/config.js"
import { listCpaQuotaAccounts } from "./lib/cpa.js"

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
      description: "查询 CPA 凭据与额度、S2A 渠道状态",
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
          bottomHelpMessage: "留空保存会保留当前密钥",
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
          label: "显示配置",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "display.timeZone",
          label: "显示时区",
          bottomHelpMessage: "用于额度重置时间，例如 Asia/Shanghai",
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
          bottomHelpMessage: "普通用户必须在此名单中；主人不受限制",
          component: "GSelectFriend",
          componentProps: { placeholder: "请选择允许查询的用户" },
        },
        {
          label: "额度告警",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "alerts.enabled",
          label: "启用告警",
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
          bottomHelpMessage: "每个 Codex 账号可设置独立的剩余额度阈值",
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
                  placeholder: "请选择 CPA 账号",
                  showSearch: true,
                  optionFilterProp: "label",
                },
              },
              {
                field: "thresholdPercent",
                label: "告警阈值",
                bottomHelpMessage: "剩余额度低于此百分比时告警",
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
          await refreshAccountOptions(config.cpa)
          return Result.ok({}, "保存成功")
        } catch (error) {
          return Result.error(error instanceof Error ? error.message : String(error))
        }
      },
    },
  }
}

async function refreshAccountOptions(cpaConfig) {
  try {
    const config = cpaConfig ?? loadConfig().cpa
    const options = await listCpaQuotaAccounts(config)
    accountOptions.splice(0, accountOptions.length, ...options)
  } catch {
    accountOptions.splice(0, accountOptions.length)
  }
}
