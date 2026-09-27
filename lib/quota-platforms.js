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

// 键为 NewAPI 渠道类型编号（constant/channel.go）。Codex 渠道通过
// /api/channel/:id/codex/usage 查询额度窗口；其余类型只读取 NewAPI 已缓存的渠道余额，
// 仅收录 NewAPI 能写入数值余额且币种已核实的类型。
const NEWAPI_QUOTA_CHANNEL_TYPES = {
  1: { key: "openai", label: "OpenAI", currency: "USD" },
  8: { key: "custom", label: "自定义渠道", currency: "USD" },
  20: { key: "openrouter", label: "OpenRouter", currency: "USD" },
  25: { key: "moonshot", label: "Moonshot", currency: "USD" },
  // NewAPI 保存 SiliconFlow 余额时未换算，数值仍是人民币。
  40: { key: "siliconflow", label: "SiliconFlow", currency: "CNY" },
  43: { key: "deepseek", label: "DeepSeek", currency: "USD" },
  57: { key: "codex", label: "Codex" },
}

// Kimi For Coding 与 GLM Coding Plan 的额度接口需要上游 API Key，而 NewAPI 不对外返回渠道
// Key，所以这两类渠道由插件按渠道单独配置 Key 后直连上游查询。渠道类型可能是 Moonshot、
// 智谱或 Anthropic 兼容，只能按 base_url（NewAPI 的 Coding Plan 预设名或上游域名）识别。
const NEWAPI_CODING_PLANS = {
  kimi: {
    key: "kimi",
    label: "Kimi",
    requiresApiKey: true,
    usageUrl: "https://api.kimi.com/coding/v1/usages",
  },
  glm: {
    key: "glm",
    label: "GLM",
    requiresApiKey: true,
    usageUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
  },
  glmInternational: {
    key: "glm",
    label: "GLM",
    requiresApiKey: true,
    usageUrl: "https://api.z.ai/api/monitor/usage/quota/limit",
  },
}

export const NEWAPI_QUOTA_PLATFORM_KEYS = [
  ...new Set([
    ...Object.values(NEWAPI_QUOTA_CHANNEL_TYPES).map(item => item.key),
    ...Object.values(NEWAPI_CODING_PLANS).map(item => item.key),
  ]),
]

export function newapiChannelPlatform(channel) {
  return (
    codingPlanPlatform(channel?.base_url) ??
    NEWAPI_QUOTA_CHANNEL_TYPES[Number(channel?.type)] ??
    null
  )
}

function codingPlanPlatform(baseUrl) {
  const value = String(baseUrl ?? "")
    .trim()
    .toLowerCase()
  if (value === "kimi-coding-plan") return NEWAPI_CODING_PLANS.kimi
  if (value === "glm-coding-plan") return NEWAPI_CODING_PLANS.glm
  if (value === "glm-coding-plan-international") return NEWAPI_CODING_PLANS.glmInternational
  let host
  try {
    host = new URL(value).hostname
  } catch {
    return null
  }
  if (host === "api.kimi.com") return NEWAPI_CODING_PLANS.kimi
  if (host === "bigmodel.cn" || host.endsWith(".bigmodel.cn")) return NEWAPI_CODING_PLANS.glm
  if (host === "z.ai" || host.endsWith(".z.ai")) return NEWAPI_CODING_PLANS.glmInternational
  return null
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
