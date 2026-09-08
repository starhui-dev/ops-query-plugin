import assert from "node:assert/strict"
import test from "node:test"
import {
  consumeEmailVerification,
  createEmailVerification,
  maskEmail,
  sendVerificationEmail,
  verifyEmailCode,
} from "../lib/email-verification.js"
import { emptyBalanceRequestState } from "../lib/balance-requests.js"

test("邮箱验证码只保存哈希，正确验证码可以一次性验证", () => {
  const state = emptyBalanceRequestState()
  const created = createEmailVerification(
    state,
    { groupId: "100", userId: "200", email: "User@Example.com" },
    1_700_000_000_000,
  )
  const verification = state.verifications["100:200"]
  assert.equal(verification.email, "user@example.com")
  assert.equal(verification.codeHash.includes(created.code), false)
  assert.equal(verifyEmailCode(state, "100", "200", created.code, 1_700_000_001_000).ok, true)
  consumeEmailVerification(state, "100", "200", verification)
  assert.equal(state.verifications["100:200"], undefined)
})

test("邮箱验证码错误次数达到上限后失效", () => {
  const state = emptyBalanceRequestState()
  const created = createEmailVerification(
    state,
    { groupId: "100", userId: "200", email: "user@example.com" },
    1_700_000_000_000,
  )
  const wrongCode = created.code === "000000" ? "000001" : "000000"
  for (let attempt = 1; attempt < 5; attempt += 1) {
    assert.equal(verifyEmailCode(state, "100", "200", wrongCode, 1_700_000_001_000).ok, false)
  }
  assert.match(
    verifyEmailCode(state, "100", "200", wrongCode, 1_700_000_001_000).message,
    /次数过多/,
  )
  assert.equal(state.verifications["100:200"], undefined)
})

test("验证码邮件使用配置的 SMTP 和脱敏邮箱", async () => {
  let transportOptions
  let message
  await sendVerificationEmail(
    {
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "bot@example.com",
      smtpPassword: "secret",
      from: "bot@example.com",
    },
    "user@example.com",
    "123456",
    options => {
      transportOptions = options
      return {
        async sendMail(value) {
          message = value
        },
        close() {},
      }
    },
  )
  assert.deepEqual(transportOptions, {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    auth: { user: "bot@example.com", pass: "secret" },
  })
  assert.equal(message.to, "user@example.com")
  assert.match(message.text, /123456/)
  assert.equal(maskEmail("user@example.com"), "ur**@example.com")
})
