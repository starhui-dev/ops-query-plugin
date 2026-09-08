export function checkQueryAccess(event, access) {
  if (event?.isMaster) return { allowed: true }

  const groupId = String(event?.group_id ?? "")
  // 名单为空表示不限制人员，此时只在白名单群内响应，私聊没有可依据的限制来源
  if (!access.queryUsers.length && !groupId) {
    return { allowed: false, reason: "未配置运维查询人员名单，私聊不可用" }
  }

  const userId = String(event?.user_id ?? "")
  if (access.queryUsers.length && !access.queryUsers.includes(userId)) {
    return { allowed: false, reason: "你不在运维查询人员名单中" }
  }

  if (groupId && !access.groupWhitelist.includes(groupId)) {
    return { allowed: false, reason: "本群未启用运维查询" }
  }
  return { allowed: true }
}

export function checkGroupAccess(event, access) {
  const groupId = String(event?.group_id ?? "")
  if (!groupId) return { allowed: false, reason: "此功能仅支持群聊" }
  if (event?.isMaster) return { allowed: true }
  if (!access.groupWhitelist.length) {
    return { allowed: false, reason: "尚未配置群聊白名单" }
  }
  if (!access.groupWhitelist.includes(groupId)) {
    return { allowed: false, reason: "本群未启用余额申请" }
  }
  return { allowed: true }
}
