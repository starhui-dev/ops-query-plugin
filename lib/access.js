export function checkQueryAccess(event, access) {
  if (event?.isMaster) return { allowed: true }

  const userId = String(event?.user_id ?? "")
  if (!access.queryUsers.includes(userId)) {
    return { allowed: false, reason: "你不在运维查询人员名单中" }
  }

  const groupId = String(event?.group_id ?? "")
  if (groupId && !access.groupWhitelist.includes(groupId)) {
    return { allowed: false, reason: "本群未启用运维查询" }
  }
  return { allowed: true }
}
