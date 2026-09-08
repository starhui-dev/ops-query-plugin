export const OPS_QUERY_RULES = [
  {
    reg: "^#?账号(额度|配额)$",
    fnc: "accountQuota",
  },
  {
    reg: "^#?渠道状态$",
    fnc: "channelStatus",
  },
  {
    reg: "^#?[Ss][Ll][Aa]$",
    fnc: "sla",
  },
  {
    reg: "^#?Codex雷达$",
    fnc: "codexRadar",
  },
  {
    reg: "^#?[Cc][Oo][Dd][Ee][Xx]\\s*重置$",
    fnc: "codexReset",
  },
  {
    reg: "^#?运维查询帮助$",
    fnc: "help",
  },
  {
    reg: "^#?S2A绑定(?:\\s+.+)?$",
    fnc: "bindAccount",
  },
  {
    reg: "^#?S2A验证码(?:\\s+.+)?$",
    fnc: "verifyEmailCode",
  },
  {
    reg: "^#?S2A申请余额(?:\\s+.+)?$",
    fnc: "requestBalance",
  },
  {
    reg: "^#?S2A通过(?:\\s+.+)?$",
    fnc: "approveBalanceRequest",
  },
  {
    reg: "^#?S2A拒绝(?:\\s+.+)?$",
    fnc: "rejectBalanceRequest",
  },
]
