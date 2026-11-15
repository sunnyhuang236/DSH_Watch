# M2 P0 生产化硬化记录

日期：2026-11-15｜范围：网关常驻、隧道地址变化、推送可靠性、通知引导、数据保留、安全复查。

## 1 已完成

| 项 | 实现 | 文件 |
| --- | --- | --- |
| 网关开机自启/后台运行 | `install-autostart.ps1` 写入当前用户 Startup 的 `DSH-Watch-M2.vbs`；`start-m2.cmd` 检查 8787 端口/cloudflared 进程，隐藏窗口启动，避免重复 | `scripts/`、启动项 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DSH-Watch-M2.vbs` |
| 隧道地址变化引导 | `tunnel.mjs` 解析 cloudflared 输出并把新 `https://…trycloudflare.com` POST 到 `/v1/admin/tunnel-url`（仅 loopback）；网关 `/v1/health.public_url` 返回当前地址；PWA 设置显示“访问地址”，地址不一致时任务页横幅提示重新打开/配对 | `packages/gateway/bin/tunnel.mjs`、`lib/server.mjs`、`apps/web/app.js` |
| 推送失败重试与订阅清理 | `PushService` 每条订阅最多 3 次（300ms/1200ms 退避）；404/410 立即删除订阅；Notifier 全部订阅失败时保留待重试 30 秒，不标记已通知 | `lib/push.mjs`、`lib/notifier.mjs` |
| 通知权限引导 | 任务页顶部横幅：未询问→“开启通知”，已拒绝→“到 iOS 设置开启”；设置页保留权限状态/按钮 | `apps/web/app.js`、`styles.css` |
| 数据保留/清理 | 插件 SQLite：保留 30 天，启动时+每日清理过期事件与过期终态任务（运行中/等待中不删）；PWA 启动时清理 30 天前提醒/终态任务缓存；设置页“清除缓存” | `packages/dsh-watch/lib/core/store.mjs`、`runtime.mjs`、`apps/web/app.js` |
| 安全复查 | 增加 `X-Content-Type-Options`/`Referrer-Policy`/`X-Frame-Options`；管理接口仍只接受 loopback，带代理头的请求一律拒绝；详见 `docs/M2-SECURITY-REVIEW.md` | `lib/server.mjs` |

## 2 自启用法

```powershell
# 安装（当前用户，无需管理员）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# 卸载
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1
# 手动启动（隐藏窗口、幂等）
scripts\start-m2.cmd
```

## 3 验证

- `npm test`：**63/63 通过**（M1 42 + M2 21）；日志 `docs/evidence/m2/tests.log`。
- 自启：Startup 下 `DSH-Watch-M2.vbs` 已生成，内容指向 `scripts/start-m2.cmd`（已验证路径）。
- 网关当前 `gateway ok=true / upstream.ok=true`；健康返回 `public_url`（已登记当前隧道地址）；证据 `docs/evidence/m2/p0-health.json`。
- 安全头实测：`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`、CSP 存在。
- 推送重试/410 清理测试：`packages/gateway/test/push.test.mjs` 通过。
- 数据保留测试：`packages/dsh-watch/test/store-prune.test.mjs` 通过。
- 隧道地址登记接口：本机 POST 成功，`health.public_url` 更新；带 `x-forwarded-for` 的请求返回 403（测试 `gateway.test.mjs`）。
- 说明：新 `tunnel.mjs` 的自动登记逻辑已实现；本次用等价 POST 验证了登记接口，下次重启隧道时会走自动路径。

## 4 实测记录（2026-11-15 00:40–00:55）

### 4.1 自启流程

1. 停止当前网关进程（8787 无监听）；
2. 执行 Startup 中的 `DSH-Watch-M2.vbs`（等价于用户登录时触发）；
3. 约 8 秒后 `GET /v1/health` 恢复 `ok=true`，`devices=2 / subs=1` 保留，网关日志正常。

结论：**Startup 隐藏启动项 → `start-m2.cmd` → 网关恢复** 通过。

### 4.2 隧道地址变化（上一轮，历史记录；当前以 §4.4 为准）

1. 停止旧 cloudflared；旧地址 `https://bigger-ultimate-pair-vincent.trycloudflare.com` 返回 **HTTP 530**；
2. 执行 Startup VBS → 自动启动新 cloudflared；
3. 新地址 `https://calvin-kyle-coordinator-advocate.trycloudflare.com` 生成，`tunnel.mjs` 自动 POST 到网关；
4. `GET /v1/health.public_url` 自动更新为新地址；新地址 `/v1/health` 返回 200；
5. 地址变化后旧 origin 的设备/订阅由网关清空（`devices=0 / subs=0`），需用新地址重新添加到主屏幕并重新配对。

结论：**地址变化自动登记 + PWA 旧 origin 失效提示 + 强制重新配对** 通过。

### 4.3 新地址重新配对 + 推送（上一轮，历史记录；当前以 §4.4 为准）

- 新隧道地址：`https://calvin-kyle-coordinator-advocate.trycloudflare.com`
- 主屏幕 PWA 重新配对成功（设备 `dev_2ef1b2118f08f1f8`，名称“iPhone”）；
- 通知重新授权后：`devices=2 / subscriptions=1`（Safari + 主屏幕 PWA，订阅为新 origin）；
- 新地址测试推送：`sent=1 / failed=0 / retried=0`；
- 旧 origin 的设备和订阅已由地址变化逻辑清空，避免幽灵通知。


### 4.4 过夜重启后的真实自启 + 第二次地址变化（2026-11-15 11:22）

- 电脑重启后，网关/云隧道于 **11:22:53** 自动启动（`Get-Process` 启动时间可证），无需人工操作；
- 新隧道地址：`https://invention-trackback-consulting-sustained.trycloudflare.com`，`public_url` 自动更新；
- 旧 origin 设备/订阅已清空；主屏幕 PWA 重新配对为 `dev_ab184e9357b6cbff`；
- 通知授权后 `subscriptions=1`（绑定该 PWA），测试推送 `sent=1 / failed=0 / retried=0`，iPhone 锁屏确认收到。

结论：**真实重启自启 + 第二次地址变化 + 重新配对 + 推送** 全部通过。

## 5 注意

- 开机自启会启动**网关和 cloudflared**；若不想自动开隧道，可在 `scripts/start-m2.ps1` 前加 `-NoTunnel`（或改 Startup VBS）。
- quick tunnel 地址仍是随机、无 SLA；地址变化时按 PWA 横幅提示重新打开新地址并配对。
- 本记录只覆盖 P0 运维硬化，不包含 M3/M4 功能。
