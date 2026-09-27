# ops-query-plugin

面向 TRSS Yunzai 的运维查询与告警插件，集中展示 CLIProxyAPI（CPA）与
NewAPI 的账号额度。

状态消息默认渲染为图片：随机动漫背景加载失败时自动使用本地备用图，信息区采用透明
毛玻璃卡片，避免 QQ 将邮箱等内容误识别为链接。

## 功能

- 统一查看 CPA 与 NewAPI 中有额度信息的账号：CPA 支持 Codex、Claude、Antigravity、Kimi、
  xAI 等 OAuth 账号；NewAPI 支持 Codex 渠道、Kimi For Coding 与 GLM Coding Plan 渠道的
  额度窗口，以及 OpenAI、自定义渠道、OpenRouter、Moonshot、SiliconFlow、DeepSeek 渠道已缓存的
  余额。展示套餐、剩余百分比、余额和重置时间，并可按渠道关闭显示。
- 获取 Codex 雷达站发布的最新速览图。
- 按 CPA/NewAPI 有额度账号设置独立额度阈值，向指定群聊发送图片告警并支持不提醒、
  @指定用户或@全体。
- 配置群聊白名单和可查询人员，人员留空表示白名单群内不限人，私聊不可用；Yunzai
  主人可绕过全部查询限制。
- 可按功能选择 CPA、NewAPI、Codex 雷达和随机背景请求是否走 HTTP/HTTPS 代理。
- 支持锅巴插件管理器，也可直接维护 YAML 配置。

## 环境要求

- TRSS Yunzai v3
- Node.js 20 或更高版本
- pnpm
- 可访问 CPA、NewAPI、Codex Radar 和背景图片接口的网络环境

## 安装

在 TRSS Yunzai 根目录执行：

```bash
git clone https://github.com/starhui-dev/ops-query-plugin.git plugins/ops-query-plugin
pnpm --dir plugins/ops-query-plugin install --prod
cp plugins/ops-query-plugin/config/config.example.yaml \
  plugins/ops-query-plugin/config/config.yaml
```

填写 `plugins/ops-query-plugin/config/config.yaml` 后重启 TRSS Yunzai。也可以在安装后
直接通过锅巴后台的“运维查询”页面填写配置。

升级时进入插件目录执行：

```bash
git pull --ff-only
pnpm install --prod --frozen-lockfile
```

## 命令

| 命令            | 作用                                 |
| --------------- | ------------------------------------ |
| `#账号额度`     | 查询 CPA/NewAPI 全部有额度信息的账号 |
| `#Codex雷达`    | 获取 Codex 雷达最新速览图            |
| `#运维查询帮助` | 显示命令帮助                         |

Sub2API（S2A）相关的 `#渠道状态`、`#SLA`、`#S2A绑定`、`#S2A验证码`、`#S2A余额`、
`#S2A申请余额`、`#S2A通过` 和 `#S2A拒绝` 已随 S2A 支持一并移除；旧的 `#S2A额度`、`#S2A状态`、
`#S2A SLA`、`#CPA…`、`#Codex额度` 和 `#Codex重置` 命令同样不再响应。

CPA 额度通过 CLIProxyAPI Management API 使用各账号对应的上游配额接口实时查询。
CPA 账号名称优先使用认证文件的备注（`note`），其次使用 `label`，未设置时才显示脱敏邮箱。

NewAPI 额度通过管理接口读取渠道列表：Codex 渠道（ChatGPT Subscription）调用
`/api/channel/:id/codex/usage` 实时查询额度窗口；OpenAI、自定义渠道、OpenRouter、Moonshot、
SiliconFlow 和 DeepSeek 渠道只展示 NewAPI 已缓存的余额及其更新时间，插件不会主动刷新余额。
除 SiliconFlow 按 NewAPI 保存的人民币原值展示外，余额均为美元。手动禁用的渠道、多密钥渠道、
从未刷新过余额的渠道和额度查询失败的渠道会被隐藏；账号名称使用 NewAPI 渠道名称。

NewAPI 不对外返回渠道 Key，因此 Kimi For Coding 与 GLM Coding Plan 渠道需要在
`newapi.channels` 中为对应渠道单独填写 API Key，由插件直连上游查询：Kimi 请求
`https://api.kimi.com/coding/v1/usages`，GLM 按渠道地址请求 `open.bigmodel.cn` 或 `api.z.ai`
的 `/api/monitor/usage/quota/limit`，展示 5 小时和每周窗口。渠道按 `base_url` 识别：NewAPI 的
`kimi-coding-plan`、`glm-coding-plan`、`glm-coding-plan-international` 预设，或
`api.kimi.com`、`bigmodel.cn`、`z.ai` 域名的地址，渠道类型不限；这类渠道支持多密钥模式。
未填写 Key 的 Kimi/GLM 渠道即使开启显示也不会展示。GLM 团队版（需要组织/项目请求头）暂不支持。

`newapi.channels` 中每个渠道还有显示开关，关闭后该渠道不出现在 `#账号额度` 中；未列出的渠道
默认显示。显示开关不影响已配置的额度告警，关闭显示的渠道仍可在告警账号中选择。

## 配置

配置模板位于 [`config/config.example.yaml`](config/config.example.yaml)，主要配置项如下：

| 配置项                  | 说明                                     |
| ----------------------- | ---------------------------------------- |
| `cpa.baseUrl`           | CLIProxyAPI 服务地址                     |
| `cpa.managementKey`     | CLIProxyAPI Management Key               |
| `newapi.baseUrl`        | NewAPI 服务地址                          |
| `newapi.accessToken`    | NewAPI 系统访问令牌                      |
| `newapi.channels`       | 按渠道设置显示开关及 Kimi/GLM API Key    |
| `display.timeZone`      | 状态和告警更新时间所用时区               |
| `access.groupWhitelist` | 普通用户可使用插件的群聊                 |
| `access.queryUsers`     | 可执行查询的普通用户，留空只放开白名单群 |
| `proxy.*`               | HTTP/HTTPS 代理地址和功能开关            |
| `alerts.*`              | 告警与订阅总开关、周期、群聊及提醒方式   |
| `alerts.accounts`       | CPA/NewAPI 额度账号及其额度告警阈值      |

告警目标群必须同时存在于群聊白名单。相同账号持续低于阈值时只提醒一次，额度恢复到
阈值以上后再次降低才会重新提醒。额度告警与 `#账号额度` 使用同一份采集逻辑，按账号
全部额度窗口中的最低剩余比例判断。

NewAPI 账号引用格式为 `newapi:<平台>:<渠道 ID>`。余额型渠道没有剩余百分比，只在
`#账号额度` 中展示，不会出现在告警账号选项中。

从 S2A 版本升级后，原有 `s2a:…` 告警账号引用、`s2a`、`balanceRequests` 和 `alerts.sla`
配置会在加载时被忽略，并在下次保存配置时移除，请在锅巴中重新选择 NewAPI 渠道。插件目录下
`data/balance-requests.json` 中的旧绑定和余额申请记录不再使用，确认无需保留后可自行删除。

NewAPI 访问令牌在 NewAPI 个人设置中生成（系统访问令牌），请求时以 `Authorization: Bearer`
发送。令牌所属账号需要是超级管理员，或是具备渠道读取权限的管理员。

可在锅巴的“代理设置”区域按功能选择是否走代理，也可直接配置 YAML：

```yaml
proxy:
  url: "http://127.0.0.1:7890"
  cpaEnabled: false
  newapiEnabled: false
  codexRadarEnabled: true
  randomBackgroundEnabled: false
```

四个开关分别控制 CPA 查询与告警、NewAPI 查询与告警（含 Kimi/GLM 上游额度查询）、
Codex 雷达和随机背景图下载。
未选中的功能始终直连，插件不会按域名或服务所在地区自动判断。支持 HTTP 和 HTTPS 代理；
需要认证时可使用 `http://用户名:密码@主机:端口`。锅巴不会回显已保存的代理地址，地址
输入框留空保存会保留原值；关闭对应功能开关即可让该功能恢复直连。

## 安全说明

- `config/config.yaml` 已加入 `.gitignore`，不要提交或分享真实密钥。
- 锅巴读取配置时不会回传 CPA Management Key、NewAPI 访问令牌或渠道 API Key；密钥输入留空
  保存会保留原值。如需清除某个渠道的 API Key，删除该渠道设置即可。
- Kimi/GLM 渠道 API Key 以明文保存在 `config/config.yaml`，只发送给对应的固定上游额度接口；
  建议只为需要查询额度的渠道填写。
- 锅巴不会回传代理地址，因为地址中可能包含代理认证信息。
- CPA 与 NewAPI 的 OAuth、API Key 等凭据仍由对应平台管理；本插件只读取账号清单并查询额度，
  不展示上游凭据内容。
- 查询权限不是 CPA/NewAPI 服务端鉴权的替代品，仍应限制管理接口的网络访问范围。

## 开发与验证

```bash
pnpm install
pnpm check
```

测试覆盖查询权限、配置校验、CPA 多类型账号额度、NewAPI Codex 额度、Kimi/GLM Coding Plan
额度、渠道余额与显示开关，以及额度告警。

## 上游项目

- [TRSS Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
- [NewAPI](https://github.com/QuantumNous/new-api)

## 第三方字体

图片模板使用未经修改的 HarmonyOS Sans SC Regular 和 Bold。字体版权归 Huawei Device
Co., Ltd. 所有，并按 [HarmonyOS Sans Fonts License Agreement](resources/fonts/HarmonyOS_Sans_SC/LICENSE.txt)
随本插件分发。

## 许可证

本项目使用 [GNU General Public License v3.0](LICENSE)（`GPL-3.0-only`）。
