// Sub2API 只为这些平台维护额度窗口；其余账号（Grok、纯计费 API Key）没有可展示的额度。
// 单独成模块，避免配置校验与额度查询相互 import。
export const QUOTA_PLATFORMS = {
  openai: { label: "Codex", types: ["oauth"] },
  anthropic: { label: "Claude", types: ["oauth"] },
  kimi: { label: "Kimi", types: ["apikey"] },
  zhipu: { label: "Zhipu GLM", types: ["apikey"] },
}

export const QUOTA_PLATFORM_KEYS = Object.keys(QUOTA_PLATFORMS)

export function quotaPlatform(account) {
  return QUOTA_PLATFORMS[String(account?.platform ?? "").toLowerCase()] ?? null
}
