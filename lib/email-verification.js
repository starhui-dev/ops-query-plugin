import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto"
import nodemailer from "nodemailer"

export const EMAIL_CODE_EXPIRES_MS = 10 * 60 * 1000
export const EMAIL_CODE_COOLDOWN_MS = 60 * 1000
export const EMAIL_CODE_WINDOW_MS = 60 * 60 * 1000
export const EMAIL_CODE_MAX_ATTEMPTS = 5
export const EMAIL_CODE_MAX_SENDS = 5

export function normalizeEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("邮箱地址无效")
  }
  return email
}

export function maskEmail(value) {
  const email = String(value ?? "")
  const at = email.indexOf("@")
  if (at <= 0) return "***"
  const local = email.slice(0, at)
  const visible = local.length <= 2 ? local[0] : `${local[0]}${local.at(-1)}`
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}${email.slice(at)}`
}

export function createEmailVerification(state, input, now = Date.now()) {
  state.verifications ??= {}
  state.verificationSends ??= []
  const groupId = normalizeId(input.groupId, "群号")
  const userId = normalizeId(input.userId, "QQ号")
  const email = normalizeEmail(input.email)
  const key = verificationKey(groupId, userId)
  const existing = state.verifications[key]
  if (existing?.sentAt && now - Date.parse(existing.sentAt) < EMAIL_CODE_COOLDOWN_MS) {
    const wait = Math.ceil((EMAIL_CODE_COOLDOWN_MS - (now - Date.parse(existing.sentAt))) / 1000)
    throw new Error(`验证码发送过于频繁，请 ${wait} 秒后重试`)
  }

  state.verificationSends = pruneSendRecords(state.verificationSends, now)
  const recentSends = state.verificationSends.filter(
    item => item.groupId === groupId && item.userId === userId,
  )
  if (recentSends.length >= EMAIL_CODE_MAX_SENDS) {
    throw new Error("验证码发送次数已达到每小时上限，请稍后再试")
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const salt = randomBytes(16).toString("hex")
  const sentAt = new Date(now).toISOString()
  const verification = {
    groupId,
    userId,
    email,
    accountId: Number(input.accountId),
    applicantName: String(input.applicantName || "")
      .trim()
      .slice(0, 80),
    sourceMessageId: input.sourceMessageId ? String(input.sourceMessageId) : "",
    codeHash: hashCode(code, salt),
    codeSalt: salt,
    attempts: 0,
    sentAt,
    expiresAt: new Date(now + EMAIL_CODE_EXPIRES_MS).toISOString(),
  }
  state.verifications[key] = verification
  state.verificationSends.push({ groupId, userId, sentAt })
  return { verification, code }
}

export function verifyEmailCode(state, groupId, userId, rawCode, now = Date.now()) {
  state.verifications ??= {}
  const key = verificationKey(groupId, userId)
  const verification = state.verifications[key]
  if (!verification)
    return { ok: false, message: "没有找到待验证的邮箱，请先使用 #绑定账号 <邮箱>" }
  if (verification.verifiedAt) return { ok: true, verification }
  if (Date.parse(verification.expiresAt) <= now) {
    delete state.verifications[key]
    return { ok: false, message: "邮箱验证码已过期，请重新使用 #绑定账号 <邮箱>" }
  }

  const code = String(rawCode ?? "").trim()
  if (!/^\d{6}$/.test(code) || !safeCodeEqual(code, verification.codeHash, verification.codeSalt)) {
    verification.attempts = Number(verification.attempts || 0) + 1
    if (verification.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      delete state.verifications[key]
      return { ok: false, message: "验证码错误次数过多，请重新使用 #绑定账号 <邮箱>" }
    }
    return {
      ok: false,
      message: `验证码错误，还可尝试 ${EMAIL_CODE_MAX_ATTEMPTS - verification.attempts} 次`,
    }
  }

  verification.verifiedAt = new Date(now).toISOString()
  return { ok: true, verification }
}

export function consumeEmailVerification(state, groupId, userId, verification) {
  const key = verificationKey(groupId, userId)
  if (state.verifications[key] === verification) delete state.verifications[key]
}

export function removeEmailVerification(state, groupId, userId) {
  state.verifications ??= {}
  state.verificationSends ??= []
  const key = verificationKey(groupId, userId)
  const existing = state.verifications[key]
  delete state.verifications[key]
  if (existing?.sentAt) {
    const index = state.verificationSends.findIndex(
      item =>
        item.groupId === String(groupId) &&
        item.userId === String(userId) &&
        item.sentAt === existing.sentAt,
    )
    if (index >= 0) state.verificationSends.splice(index, 1)
  }
}

export async function sendVerificationEmail(
  config,
  email,
  code,
  createTransport = nodemailer.createTransport,
) {
  assertEmailVerificationConfig(config)
  const transport = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPassword } } : {}),
  })
  try {
    return await transport.sendMail({
      from: config.from,
      to: email,
      subject: "邮箱绑定验证码",
      text: `你的邮箱绑定验证码是：${code}\n验证码 10 分钟内有效。如非本人操作，请忽略此邮件。`,
      html: `<p>你的邮箱绑定验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效。如非本人操作，请忽略此邮件。</p>`,
    })
  } finally {
    if (typeof transport.close === "function") transport.close()
  }
}

export function assertEmailVerificationConfig(config) {
  if (!config?.smtpHost || !config?.from) {
    throw new Error("邮箱验证码尚未配置 SMTP 地址和发件人")
  }
  if (
    !Number.isInteger(Number(config.smtpPort)) ||
    Number(config.smtpPort) < 1 ||
    Number(config.smtpPort) > 65535
  ) {
    throw new Error("邮箱验证码 SMTP 端口无效")
  }
  if (config.smtpUser && !config.smtpPassword) {
    throw new Error("邮箱验证码 SMTP 用户已填写，但密码为空")
  }
}

function safeCodeEqual(code, expectedHash, salt) {
  try {
    const actual = Buffer.from(hashCode(code, salt), "hex")
    const expected = Buffer.from(String(expectedHash), "hex")
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function hashCode(code, salt) {
  return scryptSync(code, salt, 32, { N: 16_384, r: 8, p: 1 }).toString("hex")
}

function pruneSendRecords(records, now) {
  return (Array.isArray(records) ? records : [])
    .filter(
      item =>
        Number.isFinite(Date.parse(item?.sentAt)) &&
        now - Date.parse(item.sentAt) < EMAIL_CODE_WINDOW_MS,
    )
    .slice(-500)
}

function verificationKey(groupId, userId) {
  return `${String(groupId)}:${String(userId)}`
}

function normalizeId(value, label) {
  const normalized = String(value ?? "").trim()
  if (!/^\d+$/.test(normalized) || normalized === "0") throw new Error(`${label}无效`)
  return normalized
}
