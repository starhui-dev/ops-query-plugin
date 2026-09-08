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
    reg: "^#?绑定账号(?:\\s+.+)?$",
    fnc: "bindAccount",
  },
  {
    reg: "^#?申请余额(?:\\s+.+)?$",
    fnc: "requestBalance",
  },
  {
    reg: "^#?通过(?:\\s+.+)?$",
    fnc: "approveBalanceRequest",
  },
  {
    reg: "^#?拒绝(?:\\s+.+)?$",
    fnc: "rejectBalanceRequest",
  },
]
