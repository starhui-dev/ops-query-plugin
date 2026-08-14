# ops-query-plugin

面向 TRSS Yunzai 的运维查询与告警插件，集中展示 Sub2API（S2A）Codex OAuth 账号
额度、渠道状态和 SLA。

状态消息默认渲染为图片：随机动漫背景加载失败时自动使用本地备用图，信息区采用透明
毛玻璃卡片，避免 QQ 将邮箱等内容误识别为链接。

## 功能

- 查看 S2A OpenAI OAuth 账号的 Codex 套餐、额度窗口和重置时间。
- 支持切换 S2A V1 / V2 监控：V1 展示主动探测延迟、Ping、可用率和检测记录；V2
  展示真实请求的成功率、首 Token 延迟、吞吐、缓存率、健康脉冲和模型排行。
- 获取 Codex 雷达站发布的最新速览图。
- 按 S2A OAuth 账号设置独立额度阈值，向指定群聊发送图片告警并支持不提醒、
  @指定用户或@全体。
- 按统计窗口监控 Sub2API SLA，排除余额不足、配额超限等业务限制，低于阈值时发送
  图片告警。
- 查询当前统计窗口内的 Sub2API SLA、成功请求和异常明细。
- 配置群聊白名单和可查询人员；Yunzai 主人可绕过全部查询限制。
- 支持锅巴插件管理器，也可直接维护 YAML 配置。

## 环境要求

- TRSS Yunzai v3
- Node.js 20 或更高版本
- pnpm
- 可访问 S2A 和背景图片接口的网络环境

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

| 命令                        | 作用                          |
| --------------------------- | ----------------------------- |
| `#Codex额度` / `#Codex配额` | 查询 S2A Codex OAuth 账号额度 |
| `#S2A状态` / `#渠道状态`    | 查询 S2A 渠道监控             |
| `#SLA` / `#S2A SLA`         | 查询 Sub2API SLA              |
| `#Codex雷达`                | 获取 Codex 雷达最新速览图     |
| `#运维查询帮助`             | 显示命令帮助                  |

## 配置

配置模板位于 [`config/config.example.yaml`](config/config.example.yaml)，主要配置项如下：

| 配置项                  | 说明                                     |
| ----------------------- | ---------------------------------------- |
| `s2a.baseUrl`           | Sub2API 服务地址                         |
| `s2a.adminApiKey`       | Sub2API Admin API Key                    |
| `s2a.monitorVersion`    | 渠道监控版本，可选 `v1` 或 `v2`          |
| `display.timeZone`      | 状态和告警更新时间所用时区               |
| `access.groupWhitelist` | 普通用户可使用插件的群聊                 |
| `access.queryUsers`     | 可执行查询的普通用户                     |
| `alerts.*`              | 告警开关、周期、群聊、提醒方式及额度账号 |
| `alerts.sla.*`          | Sub2API SLA 开关、统计窗口和最低阈值     |

告警目标群必须同时存在于群聊白名单。相同账号持续低于阈值时只提醒一次，额度恢复到
阈值以上后再次降低才会重新提醒。额度告警使用 Sub2API 批量用量接口，按 5 小时和 7 天
窗口中的最低剩余比例判断。

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
- OAuth 账号和凭据由 Sub2API 管理；本插件只读取账号状态和额度，不读取或展示上游
  OAuth 凭据。
- 查询权限不是 S2A 服务端鉴权的替代品，仍应限制管理接口的网络访问范围。

## 开发与验证

```bash
pnpm install
pnpm check
```

测试覆盖查询权限、配置校验、Codex 额度与告警、SLA 告警，以及 S2A V1 渠道历史与
V2 聚合指标处理。

## 上游项目

- [TRSS Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- [Sub2API](https://github.com/Wei-Shaw/sub2api)

## 许可证

本项目使用 [GNU General Public License v3.0](LICENSE)（`GPL-3.0-only`）。
