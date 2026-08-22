// OAuth 额度不再从 Sub2API 查询；这里只保留带额度快照的 Key 账号。
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
  kimi: { label: "Kimi", types: ["apikey"] },
  zhipu: { label: "Zhipu GLM", types: ["apikey"] },
}

export const QUOTA_PLATFORM_KEYS = Object.keys(QUOTA_PLATFORMS)

export function quotaPlatform(account) {
  return QUOTA_PLATFORMS[String(account?.platform ?? "").toLowerCase()] ?? null
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
