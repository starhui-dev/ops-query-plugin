// 平台描述只负责展示和账号引用校验；账号是否真的有额度由各平台采集器决定。
// 单独成模块，避免配置校验与额度查询相互 import。
export const CPA_QUOTA_PLATFORMS = {
  antigravity: { label: "Antigravity" },
  claude: { label: "Claude" },
  codex: { label: "Codex" },
  kimi: { label: "Kimi" },
  xai: { label: "xAI" },
}

export const CPA_QUOTA_PLATFORM_KEYS = Object.keys(CPA_QUOTA_PLATFORMS)

export const QUOTA_PLATFORMS = {
  openai: { label: "OpenAI" },
  anthropic: { label: "Anthropic" },
  gemini: { label: "Gemini" },
  antigravity: { label: "Antigravity" },
  grok: { label: "Grok" },
  kimi: { label: "Kimi" },
  zhipu: { label: "Zhipu GLM" },
  deepseek: { label: "DeepSeek" },
  minimax: { label: "MiniMax" },
}

export const QUOTA_PLATFORM_KEYS = Object.keys(QUOTA_PLATFORMS)

export function quotaPlatform(account) {
  const platform = String(account?.platform ?? "")
    .trim()
    .toLowerCase()
  if (!platform) return null
  return QUOTA_PLATFORMS[platform] ?? { label: humanizePlatform(platform) }
}

export function cpaQuotaPlatform(account) {
  return CPA_QUOTA_PLATFORMS[normalizeCpaProvider(account?.provider ?? account?.type)] ?? null
}

export function normalizeCpaProvider(value) {
  const provider = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
  return provider === "x-ai" || provider === "grok" ? "xai" : provider
}

function humanizePlatform(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
