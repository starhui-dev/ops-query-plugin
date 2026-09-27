export const OPS_QUERY_RULES = [
  {
    reg: "^#?账号(额度|配额)$",
    fnc: "accountQuota",
  },
  {
    reg: "^#?Codex雷达$",
    fnc: "codexRadar",
  },
  {
    reg: "^#?运维查询帮助$",
    fnc: "help",
  },
]
