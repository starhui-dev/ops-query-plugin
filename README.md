# ops-query-plugin

面向 TRSS Yunzai 的运维查询与告警插件，集中展示 Sub2API（S2A）各平台账号
额度、渠道状态和 SLA，并订阅 Codex 重置公告。

状态消息默认渲染为图片：随机动漫背景加载失败时自动使用本地备用图，信息区采用透明
毛玻璃卡片，避免 QQ 将邮箱等内容误识别为链接。

## 功能

- 查看 S2A 中带额度窗口的账号：OpenAI OAuth（Codex 套餐、5 小时／每周及附加额度）、
  Anthropic OAuth、Kimi 和 Zhipu GLM，展示剩余百分比和重置时间；没有额度窗口的账号
  （如纯计费 API Key、Grok）不会出现在结果里。
- 支持切换 S2A V1 / V2 监控：V1 展示主动探测延迟、Ping、可用率和检测记录；V2
  展示真实请求的成功率、首 Token 延迟、吞吐、缓存率、健康脉冲和模型排行。
- 获取 Codex 雷达站发布的最新速览图。
- 查询 Codex 最新重置公告和当前重置预测；发现新的已确认公告时向指定群聊推送通知。
- 按 S2A 账号设置独立额度阈值，向指定群聊发送图片告警并支持不提醒、
  @指定用户或@全体。
- 按统计窗口监控 Sub2API SLA，排除余额不足、配额超限等业务限制，低于阈值时发送
  图片告警。
- 查询当前统计窗口内的 Sub2API SLA、成功请求和异常明细。
- 配置群聊白名单和可查询人员；Yunzai 主人可绕过全部查询限制。
- 可按功能选择 S2A、Codex 雷达、Codex 重置和随机背景请求是否走 HTTP/HTTPS 代理。
- 支持锅巴插件管理器，也可直接维护 YAML 配置。

## 环境要求

- TRSS Yunzai v3
- Node.js 20 或更高版本
- pnpm
- 可访问 S2A、Codex Radar、Codex Resets 和背景图片接口的网络环境

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

| 命令                         | 作用                      |
| ---------------------------- | ------------------------- |
| `#S2A额度` / `#S2A 额度`     | 查询 S2A 各平台账号额度   |
| `#S2A状态` / `#渠道状态`     | 查询 S2A 渠道监控         |
| `#SLA` / `#S2A SLA`          | 查询 Sub2API SLA          |
| `#Codex雷达`                 | 获取 Codex 雷达最新速览图 |
| `#Codex重置` / `#Codex 重置` | 查询最新 Codex 重置公告   |
| `#运维查询帮助`              | 显示命令帮助              |

额度和 Codex 重置命令不区分英文字母大小写，并允许在 `S2A`、`Codex` 与中文命令词之间
添加空格。

OpenAI OAuth 账号的额度来自 Sub2API 的额度接口，实时查询；Anthropic、Kimi 和 Zhipu
的额度来自 Sub2API 在账号被调用时记录的快照，可能有分钟级滞后。

## 配置

配置模板位于 [`config/config.example.yaml`](config/config.example.yaml)，主要配置项如下：

| 配置项                  | 说明                                   |
| ----------------------- | -------------------------------------- |
| `s2a.baseUrl`           | Sub2API 服务地址                       |
| `s2a.adminApiKey`       | Sub2API Admin API Key                  |
| `s2a.monitorVersion`    | 渠道监控版本，可选 `v1` 或 `v2`        |
| `display.timeZone`      | 状态和告警更新时间所用时区             |
| `access.groupWhitelist` | 普通用户可使用插件的群聊               |
| `access.queryUsers`     | 可执行查询的普通用户                   |
| `proxy.*`               | HTTP/HTTPS 代理地址和功能开关          |
| `alerts.*`              | 告警与订阅总开关、周期、群聊及提醒方式 |
| `alerts.accounts`       | S2A 额度账号及其额度告警阈值           |
| `alerts.codexResets.*`  | Codex 重置公告订阅开关                 |
| `alerts.sla.*`          | Sub2API SLA 开关、统计窗口和最低阈值   |

告警目标群必须同时存在于群聊白名单。相同账号持续低于阈值时只提醒一次，额度恢复到
阈值以上后再次降低才会重新提醒。额度告警与 `#S2A额度` 使用同一份采集逻辑，按账号
全部额度窗口中的最低剩余比例判断。

Codex 重置订阅使用 [Codex Resets 公共 API](https://codex-resets.com/api/docs)，只推送新的
已确认重置公告，不推送 AI 预测。首次启用只记录当前最新公告，不补发历史内容；最后处理的
Post ID 持久化在 `data/codex-resets.json`，机器人重启后不会重复推送。手动执行
`#Codex重置` 无需启用订阅，并会同时展示当前 AI 预测且明确标记其非官方性质。

可在锅巴的“代理设置”区域按功能选择是否走代理，也可直接配置 YAML：

```yaml
proxy:
  url: "http://127.0.0.1:7890"
  s2aEnabled: false
  codexRadarEnabled: true
  codexResetsEnabled: true
  randomBackgroundEnabled: false
```

四个开关分别控制 S2A 查询与告警、Codex 雷达、Codex 重置查询与订阅、随机背景图下载。
未选中的功能始终直连，插件不会按域名或服务所在地区自动判断。支持 HTTP 和 HTTPS 代理；
需要认证时可使用 `http://用户名:密码@主机:端口`。锅巴不会回显已保存的代理地址，地址
输入框留空保存会保留原值；关闭对应功能开关即可让该功能恢复直连。

SLA 告警使用 Sub2API Ops 概览的官方口径：`成功请求 /（成功请求 + 非业务限制异常）`。
无有效请求样本时不会告警；SLA 恢复到阈值以上后，再次降低才会重新提醒。该接口要求
Sub2API 已启用运维监控。

`#SLA` 查询使用 `alerts.sla.timeRange` 配置的统计窗口，默认查询近 1 小时；无需启用
SLA 告警即可使用。

`s2a.monitorVersion` 默认为 `v1`。选择 `v2` 前，需要先在 Sub2API 中启用渠道监控并将
`channel_monitor_mode` 切换为 `v2`；否则 Sub2API 会拒绝 V2 监控接口请求。

## 安全说明

- `config/config.yaml` 已加入 `.gitignore`，不要提交或分享真实密钥。
- 锅巴读取配置时不会回传 S2A Admin API Key；密钥输入留空保存会保留原值。
- 锅巴不会回传代理地址，因为地址中可能包含代理认证信息。
- 账号和凭据由 Sub2API 管理；本插件只读取账号状态和额度，不读取或展示上游凭据。
- 查询权限不是 S2A 服务端鉴权的替代品，仍应限制管理接口的网络访问范围。

## 开发与验证

```bash
pnpm install
pnpm check
```

测试覆盖查询权限、配置校验、多平台账号额度与告警、重置订阅、SLA 告警，以及 S2A V1
渠道历史与 V2 聚合指标处理。

## 上游项目

- [TRSS Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- [Sub2API](https://github.com/Wei-Shaw/sub2api)
- [Codex Resets](https://codex-resets.com/)

## 第三方字体

图片模板使用未经修改的 HarmonyOS Sans SC Regular 和 Bold。字体版权归 Huawei Device
Co., Ltd. 所有，并按 [HarmonyOS Sans Fonts License Agreement](resources/fonts/HarmonyOS_Sans_SC/LICENSE.txt)
随本插件分发。

## 许可证

本项目使用 [GNU General Public License v3.0](LICENSE)（`GPL-3.0-only`）。
