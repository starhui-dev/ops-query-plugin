import {
  CPA_QUOTA_PLATFORM_KEYS,
  QUOTA_PLATFORM_KEYS,
  normalizeCpaProvider,
} from "./quota-platforms.js"

export function parseQuotaAccountReference(value) {
  const reference = String(value ?? "").trim()
  const firstSeparator = reference.indexOf(":")
  if (firstSeparator <= 0 || firstSeparator === reference.length - 1) return null
  const firstPart = reference.slice(0, firstSeparator)
  const remainder = reference.slice(firstSeparator + 1)

  if (["cpa", "s2a"].includes(firstPart.toLowerCase())) {
    const secondSeparator = remainder.indexOf(":")
    if (secondSeparator <= 0 || secondSeparator === remainder.length - 1) return null
    return normalizeQuotaAccount(
      firstPart,
      remainder.slice(0, secondSeparator),
      remainder.slice(secondSeparator + 1),
    )
  }

  const platform = firstPart
  const accountId = remainder
  if (platform.toLowerCase() === "codex") {
    return normalizeQuotaAccount("cpa", platform, accountId)
  }
  if (QUOTA_PLATFORM_KEYS.includes(platform.toLowerCase()) && isPositiveInteger(accountId)) {
    return normalizeQuotaAccount("s2a", platform, accountId)
  }
  if (CPA_QUOTA_PLATFORM_KEYS.includes(normalizeCpaProvider(platform))) {
    return normalizeQuotaAccount("cpa", platform, accountId)
  }
  return null
}

export function normalizeQuotaAccount(sourceValue, platformValue, accountIdValue) {
  const source = String(sourceValue).trim().toLowerCase()
  const rawPlatform = String(platformValue).trim().toLowerCase()

  if (source === "cpa") {
    const platform = normalizeCpaProvider(rawPlatform)
    const accountId = String(accountIdValue).trim()
    if (!CPA_QUOTA_PLATFORM_KEYS.includes(platform) || !isCpaAuthIndex(accountId)) return null
    return { source, platform, accountId }
  }
  if (source === "s2a") {
    const platform = rawPlatform
    const accountId = Number(accountIdValue)
    if (!QUOTA_PLATFORM_KEYS.includes(platform) || !isPositiveInteger(accountId)) return null
    return { source, platform, accountId }
  }
  return null
}

export function formatQuotaAccountReference(account) {
  const normalized = normalizeQuotaAccount(account?.source, account?.platform, account?.accountId)
  return normalized ? `${normalized.source}:${normalized.platform}:${normalized.accountId}` : ""
}

export function quotaAccountKey(source, platform, accountId) {
  return `${String(source).toLowerCase()}:${String(platform).toLowerCase()}:${String(accountId)}`
}

function isPositiveInteger(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0
}

function isCpaAuthIndex(value) {
  return /^\S+$/.test(String(value ?? "").trim())
}
