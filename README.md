# ops-query-plugin

面向 TRSS Yunzai 的运维查询与额度告警插件，集中展示 CLIProxyAPI（CPA）凭据、
Codex 订阅额度和 Sub2API（S2A）渠道状态。

状态消息默认渲染为图片：随机动漫背景加载失败时自动使用本地备用图，信息区采用透明
毛玻璃卡片，避免 QQ 将邮箱等内容误识别为链接。

## 功能

- 查看 CPA OAuth 凭据和 Codex API 渠道状态，包括累计请求、近期健康率、优先级与
  WRR 权重；API Key 始终脱敏。
- 按 CPA Codex 账号查看订阅额度、套餐和重置时间。
- 查看 S2A 渠道的对话延迟、端点 Ping、7 天可用率和最近 60 次检测记录。
- 按账号设置独立额度阈值，向指定群聊发送图片告警并支持不提醒、@指定用户或@全体。
- 配置群聊白名单和可查询人员；Yunzai 主人可绕过全部查询限制。
- 支持锅巴插件管理器，也可直接维护 YAML 配置。

## 环境要求

- TRSS Yunzai v3
- Node.js 20 或更高版本
- pnpm
- 可访问 CPA、S2A 和背景图片接口的网络环境

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

| 命令                            | 作用                               |
| ------------------------------- | ---------------------------------- |
| `#Codex额度` / `#CPA Codex额度` | 查询 CPA Codex 账号订阅额度        |
| `#CPA状态`                      | 查询 CPA 凭据和 Codex API 渠道状态 |
| `#S2A状态` / `#渠道状态`        | 查询 S2A 渠道监控                  |
| `#运维查询帮助`                 | 显示命令帮助                       |

## 配置

配置模板位于 [`config/config.example.yaml`](config/config.example.yaml)，主要配置项如下：

| 配置项                  | 说明                                       |
| ----------------------- | ------------------------------------------ |
| `cpa.baseUrl`           | CLIProxyAPI 服务地址                       |
| `cpa.managementKey`     | CLIProxyAPI Management Key                 |
| `s2a.baseUrl`           | Sub2API 服务地址                           |
| `s2a.adminApiKey`       | Sub2API Admin API Key                      |
| `display.timeZone`      | 额度重置和状态更新时间所用时区             |
| `access.groupWhitelist` | 普通用户可使用插件的群聊                   |
| `access.queryUsers`     | 可执行查询的普通用户                       |
| `alerts.*`              | 告警开关、周期、群聊、提醒方式和按账号阈值 |

告警目标群必须同时存在于群聊白名单。相同账号持续低于阈值时只提醒一次，额度恢复到
阈值以上后再次降低才会重新提醒。

## 安全说明

- `config/config.yaml` 已加入 `.gitignore`，不要提交或分享真实密钥。
- 锅巴读取配置时不会回传 CPA Management Key 或 S2A Admin API Key；密钥输入留空保存
  会保留原值。
- CPA 状态图片仅展示脱敏后的 Codex API Key，并移除服务地址中的用户信息、查询参数
  和 URL 片段。
- 查询权限不是 CPA/S2A 服务端鉴权的替代品，仍应限制这些管理接口的网络访问范围。

## 开发与验证

```bash
pnpm install
pnpm check
```

测试覆盖查询权限、配置校验、按账号告警、CPA 状态与额度格式化，以及 S2A 渠道历史
数据处理。

## 上游项目

- [TRSS Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## 许可证

本项目使用 [GNU General Public License v3.0](LICENSE)（`GPL-3.0-only`）。
