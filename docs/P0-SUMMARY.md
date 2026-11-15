# P0 生产化硬化 · 一页汇总

日期：2026-11-15 11:37｜状态：**✅ 全部完成并通过实测**
详细记录：[M2-P0-HARDENING.md](M2-P0-HARDENING.md)｜安全复查：[M2-SECURITY-REVIEW.md](M2-SECURITY-REVIEW.md)

## 1 六项交付

| # | 目标 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 网关开机自启/后台运行 | ✅ 当前用户 Startup `DSH-Watch-M2.vbs` → `start-m2.cmd`；隐藏窗口、幂等 | 停网关后 Startup 8 秒恢复；**11/15 11:22 真实重启自动启动** |
| 2 | cloudflared 地址变化引导 | ✅ `tunnel.mjs` 自动登记新地址；`/v1/health.public_url`；PWA 地址提示 | 旧地址 530 → 新地址 `/v1/health` 200；地址变化自动清空旧 origin 设备/订阅 |
| 3 | 推送失败重试与订阅清理 | ✅ 每条订阅 3 次退避重试；404/410 自动删除；全失败 30 秒重试 | `push.test.mjs` 重试/410 用例通过 |
| 4 | 通知权限引导 | ✅ 任务页横幅（未询问/已拒绝）；设置页权限状态与开启按钮 | PWA 代码 + 真机授权 |
| 5 | 数据保留/清理 | ✅ 插件 SQLite 30 天；PWA 本地 30 天；设置页“清除缓存” | `store-prune.test.mjs` 通过 |
| 6 | 安全复查 | ✅ 三项安全响应头；管理接口仅 loopback；隧道请求 403 | `M2-SECURITY-REVIEW.md` |

## 2 最终运行状态

- 网关：`http://127.0.0.1:8787`，`ok=true`、`upstream.ok=true`
- 插件：`http://127.0.0.1:7317`，`ok=true`
- 当前隧道：`https://invention-trackback-consulting-sustained.trycloudflare.com`
- 设备：`devices=2`（Safari + 主屏幕 PWA）；推送订阅 `subscriptions=1`（绑定主屏幕 PWA `dev_ab184e9357b6cbff`）
- 测试：**63/63 通过**（M1 42 + M2 21）

## 3 实测时间线

| 时间 | 测试 | 结果 |
| --- | --- | --- |
| 11/15 00:40 | 停网关 → 执行 Startup VBS | 8 秒后网关恢复，设备/订阅保留 |
| 11/15 00:52 | 停旧隧道 → Startup 拉起新隧道 | 旧地址 530、新地址 200、`public_url` 自动更新、旧设备清空 |
| 11/15 11:22 | 过夜重启（真实开机） | 网关 + 隧道自动启动，`public_url` 更新为当前地址 |
| 11/15 11:37 | 新地址 PWA 重新配对 + 授权 | `subscriptions=1`，测试推送 `sent=1 / failed=0 / retried=0`，iPhone 已收到 |

## 4 使用注意

1. **quick tunnel 地址会变**：电脑重启/隧道重启后地址变化，需要重新打开新地址并重新配对；旧地址的 PWA 图标失效。
2. **不要删除主屏幕 PWA 图标**：iOS 会同时清掉其本地存储（token/设置），删除后必须重新配对。
3. 自启会同时启动网关和 cloudflared；不想自动开隧道可从 Startup 移除 VBS（`scripts/uninstall-autostart.ps1`）。
4. 自启脚本：安装 `scripts/install-autostart.ps1`；卸载 `scripts/uninstall-autostart.ps1`；手动启动 `scripts/start-m2.cmd`。

## 5 相关文件

- 代码：`packages/gateway/lib/{push,notifier,server,store}.mjs`、`packages/dsh-watch/lib/core/store.mjs`、`packages/dsh-watch/lib/runtime.mjs`、`apps/web/{app.js,styles.css,sw.js}`
- 脚本：`scripts/{install-autostart,uninstall-autostart,start-m2,start-m2.cmd}`
- 测试：`packages/gateway/test/push.test.mjs`、`packages/gateway/test/gateway.test.mjs`、`packages/dsh-watch/test/store-prune.test.mjs`
