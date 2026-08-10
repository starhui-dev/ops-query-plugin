export function maskAccount(value) {
  const account = singleLine(value).trim()
  if (!account) return "未知账号"
  if (account === "未知账号") return account

  const at = account.lastIndexOf("@")
  if (at > 0 && at < account.length - 1) {
    const local = account.slice(0, at)
    const domain = account.slice(at + 1)
    const suffix = local.length > 2 ? local.at(-1) : ""
    return `${local[0]}...${suffix}@${domain}`
  }

  if (account.length <= 4) return `${account[0]}...`
  return `${account.slice(0, 2)}......${account.slice(-2)}`
}

function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ")
}
