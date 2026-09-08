export function isBalanceAdmin(event, configuredUsers = []) {
  if (event?.isMaster) return true
  return configuredUsers.map(String).includes(String(event?.user_id ?? ""))
}
