import assert from "node:assert/strict"
import test from "node:test"
import { maskAccount } from "../lib/privacy.js"

test("脱敏邮箱和普通账号标识", () => {
  assert.equal(maskAccount("user@example.com"), "u...r@example.com")
  assert.equal(maskAccount("ab@example.com"), "a...@example.com")
  assert.equal(maskAccount("codex-account-1234"), "co......34")
  assert.equal(maskAccount(""), "未知账号")
})
