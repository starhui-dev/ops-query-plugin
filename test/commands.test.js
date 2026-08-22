import assert from "node:assert/strict"
import test from "node:test"
import { OPS_QUERY_RULES } from "../lib/commands.js"

function matchedFunction(message) {
  return OPS_QUERY_RULES.find(rule => new RegExp(rule.reg).test(message))?.fnc ?? null
}

test("运维命令使用统一的无后端前缀名称", () => {
  assert.equal(matchedFunction("#账号额度"), "accountQuota")
  assert.equal(matchedFunction("#账号配额"), "accountQuota")
  assert.equal(matchedFunction("#渠道状态"), "channelStatus")
  assert.equal(matchedFunction("#SLA"), "sla")
})

test("不再响应旧的后端或产品前缀命令", () => {
  for (const command of [
    "#S2A额度",
    "#S2A 额度",
    "#S2A状态",
    "#S2A SLA",
    "#CPA额度",
    "#CPA Codex额度",
    "#CPA状态",
    "#Codex额度",
  ]) {
    assert.equal(matchedFunction(command), null, command)
  }
})
