# DSH 移动盯梢器部署指南

适用：Windows 10/11 + DSH Desktop 0.2.2-rc.1（或兼容版本）。目标：装好 `dsh-watch` 插件、网关和 PWA，让手机能收到任务完成/失败/等待提醒。

## 0 一键安装（推荐给朋友）

前置：Windows + Node.js 24 LTS + DSH Desktop（至少启动过一次）。

1. 双击项目根目录 **`install.cmd`**：自动安装 gateway 依赖、运行测试、安装 `dsh-watch` 插件；
2. 重启 DSH Desktop；
3. 双击 **`start-dsh-watch.cmd`**：自动启动网关 + cloudflared + 手机配对；
4. 手机按终端显示的地址/配对码操作。

如果 DSH 是 Web profile：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-dsh-watch.ps1 -Profile web
```

下面的 1–9 节是手动部署步骤，供排查或高级环境使用。

## 1 组件

| 组件 | 作用 | 位置 |
| --- | --- | --- |
| `dsh-watch` | DSH 插件，订阅事件、归一化、SQLite、只读 API | `packages/dsh-watch` |
| gateway | 配对、设备 token、`/v1` 反向代理、PWA 托管、Web Push | `packages/gateway` |
| PWA | 手机主屏幕 App，任务/详情/提醒/审批/问答 | `apps/web` |
| cloudflared | 可选；给 PWA 提供公网 HTTPS quick tunnel | 系统安装或 `.data/bin/cloudflared.exe` |
| M3 SwiftUI | 可选展示版；GitHub Actions 出未签名 IPA，Sideloadly 安装 | `apps/ios` |

## 2 前置条件

- DSH Desktop 已安装并至少启动过一次；
- Node.js 24+（`node --version`）；
- 可选：Git、cloudflared、Sideloadly（仅 M3 需要）。

## 3 安装依赖

```powershell
cd C:\Users\22472\Desktop\DSH提醒小助手\dsh-mobile-watch
npm install --prefix packages/gateway
npm test
```

预期：全部测试通过（当前 71/71）。

## 4 安装 DSH 插件

本机开发环境的 desktop profile 已经通过 `file:` 依赖指向 `packages/dsh-watch`。换机器时二选一：

### 方式 A：DSH 插件管理器（推荐）

1. 打开 DSH 桌面 → 插件/设置；
2. 选择“安装本地插件”；
3. 选择 `dsh-mobile-watch\packages\dsh-watch`；
4. 确认 `dsh-watch` 出现在插件列表并启用；
5. 重启 DSH。

### 方式 B：手动写入 profile（高级）

把 `packages/dsh-watch` 加入 `~/.dsh/profiles/desktop/package.json` 的 dependencies，并在 `dsh.profile.bundles` 中加入 `dsh-watch`，然后在 profile 目录执行包管理器安装。不要修改 `ui-theme` 等 UI 插件。

验证插件：

```powershell
Invoke-RestMethod http://127.0.0.1:7317/v1/health
```

应返回 `ok: true`，并且有 `tasks/events` 统计。

## 5 启动网关

```powershell
cd C:\Users\22472\Desktop\DSH提醒小助手\dsh-mobile-watch
.\scripts\start-m2.cmd
# 或 npm run gateway
```

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/health
```

默认 gateway 只监听 `127.0.0.1:8787`；M3 局域网演示时用 `scripts\start-m3-lan.cmd` 切到 `0.0.0.0:8787`，演示完建议切回。

## 6 启动隧道并配对手机

```powershell
npm run tunnel
# 终端会打印 https://xxxx.trycloudflare.com
npm run pair
# 记下 8 位配对码
```

手机：

1. Safari 打开 tunnel 根地址；
2. 分享 → 添加到主屏幕；
3. 从新图标打开；
4. 输入配对码；
5. 设置 → 开启通知 → 允许。

## 7 安全边界

- 配对管理、`/v1/admin/*` 只接受 loopback；
- 设备 token 只存 sha256；不要把 `state.json` 或 API key 放进仓库；
- quick tunnel 地址会变化，变化后旧 PWA 需要重新添加/配对；
- 不要把 `01_交付物` 当部署目录，也不要修改 DSH 源码或原始 session 日志。

## 8 可选：M3 SwiftUI

1. GitHub Actions 运行 `Build DSHWatch unsigned IPA`；
2. 下载 artifact；
3. Windows 用 Sideloadly 免费签名安装；
4. 演示前运行 `scripts\start-m3-lan.cmd`，手机热点/局域网地址填 `http://<电脑IP>:8787`。

## 9 常见问题

| 现象 | 处理 |
| --- | --- |
| 7317 health 失败 | 检查 `dsh-watch` 插件是否启用，重启 DSH |
| 8787 失败 | 检查端口占用；`scripts\start-m2.cmd` 会跳过已运行进程 |
| PWA 连接中断 | 检查 cloudflared 进程/新 tunnel 地址；地址变化必须重新配对 |
| 手机通知没有 | PWA 设置开启通知；确认 `subscriptions` > 0 |
| DSH 启动崩溃 | 不要禁用 `ui-theme`；用 profile patch 备份恢复，见 `docs/M2-P0-HARDENING.md` |
