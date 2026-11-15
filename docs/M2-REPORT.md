# M2 可用版报告（网关 + PWA + Web Push）

日期：2026-11-14｜执行：M2 研发（lead）｜代码：`dsh-mobile-watch/packages/gateway`、`apps/web`

## 0 结论

**M2 代码、本地端到端验收、V07 公网隧道与 V06 iPhone 到达率均通过（20/20，100%）。**

| 项 | 状态 |
| --- | --- |
| 网关（配对/凭证/反代/PWA 托管/Web Push） | ✅ 完成 |
| PWA（配对/列表/详情/提醒/设置/SW/manifest/图标） | ✅ 完成 |
| 自动化测试 | ✅ **63/63**（M1 42 + M2 21） |
| 本地 E2E（真实插件 7317 → 网关 8787 → PWA） | ✅ 通过（5 个真实任务） |
| Web Push 加密（VAPID + aes128gcm） | ✅ 离线验证（web-push 生成请求头/密文） |
| **V06 iPhone 主屏幕 + Web Push 到达率** | ✅ **通过**：20 次触发 **20/20 到达（100%）**，锁屏通知 + App 提醒记录均验证；见 `docs/V06-ACCEPTANCE-RESULT.md` |
| cloudflared 免费隧道（V07） | ✅ **已实测**：cloudflared 2026.11.0，`https://bigger-ultimate-pair-vincent.trycloudflare.com`，公网 HTTPS + PWA + SW 均通过 |
| 真机 PWA 安装/通知权限 | ✅ 已安装（主屏幕独立窗口）、通知已允许 |

## 1 交付物

| 路径 | 内容 |
| --- | --- |
| `packages/gateway/` | `dsh-watch-gateway`：配对、设备 token、`/v1` 反代、静态 PWA、Web Push、通知轮询、可选 TLS/隧道 |
| `packages/gateway/bin/gateway.mjs` | 网关启动 |
| `packages/gateway/bin/pair.mjs` | 电脑端配对助手（二维码 + 8 位码 + 确认） |
| `packages/gateway/bin/tunnel.mjs` | cloudflared 隧道启动（需已安装） |
| `apps/web/` | PWA：`index.html`、`app.js`、`styles.css`、`sw.js`、`manifest.webmanifest`、icons |
| `packages/gateway/test/` | 20 项测试：配对/鉴权/反代/推送/通知/PWA 静态 |
| `tools/m2-e2e.mjs` | 真实插件 → 网关 → PWA 的本地 E2E |
| `tools/m2-screenshot.mjs` | CDP 截图（注入配对 token） |
| `docs/evidence/m2/` | E2E JSON/控制台、测试日志 |
| `docs/evidence/panel/m2-*.png` | 任务列表/详情/设置/配对页截图 |

## 2 架构与契约

```
DSH 0.2.2-rc.1
  └─ dsh-watch 插件 (127.0.0.1:7317)  ← M1 只读 API
        ↑ /v1 反代（strip Authorization，5s timeout）
dsh-watch-gateway (127.0.0.1:8787)
  ├─ 配对：POST /v1/pair/sessions（仅 loopback）→ 8 位码 5 分钟
  ├─ 手机：POST /v1/pair/requests（code + device_name）→ poll_token
  ├─ 电脑：POST /v1/pair/sessions/{id}/confirm → 设备 token（只交付手机一次）
  ├─ 鉴权：Authorization: Bearer dsw_…（服务端只存 sha256）
  ├─ PWA：/、/app.js、/sw.js、/manifest、/icons
  ├─ Web Push：VAPID P-256 + RFC8291 aes128gcm（web-push）
  └─ 通知轮询：/v1/tasks 每秒 → 3s 合并窗口 → 终态/等待变化 → 推送
PWA（Safari / 主屏幕）
  ├─ S01 配对、S02 列表、S03 详情、S05 提醒记录、S06 设置
  ├─ IndexedDB：tasks / reminders / meta（settings）
  └─ Service Worker：缓存 + push + notificationclick 深链
```

不改变 M1 契约；网关只做门卫与投递，不写业务状态。

## 3 配对与安全

- 配对码：8 位数字、5 分钟、每会话最多 5 个请求、按 IP 60/min 限速。
- 管理接口（创建会话/查看/确认）**只接受 loopback**；带 `cf-connecting-ip`/`x-forwarded-for` 的隧道请求视为非本机。
- 设备 token：`dsw_` + 24 字节随机；状态文件只存 sha256；撤销即失效并清订阅。
- VAPID 私钥在本机 `~/.dsh/dsh-watch-gateway/state.json`（尽量 0600）；不写日志、不入交付物。
- 推送 payload：`{v,kind,task,event,at}`，无标题/摘要/路径；锁屏默认只显示“DSH Watch / 打开查看详情”。
- PWA 使用 CSP（`default-src 'self'`）、同源 API；token 存 localStorage（本机浏览器）。

## 4 PWA 页面与截图

| 页面 | 截图 |
| --- | --- |
| S01 配对（8 位码 + 设备名） | `docs/evidence/panel/m2-pair.png` |
| S02 任务列表（待处理/运行中/最近结束 + 统计） | `docs/evidence/panel/m2-tasks.png` |
| S03 任务详情（状态/步骤/摘要/时间/事件） | `docs/evidence/panel/m2-detail.png` |
| S06 设置（提醒开关/通知权限/安装引导/隐私/设备） | `docs/evidence/panel/m2-settings.png` |

设计 Token 对齐 `DESIGN_HANDOFF §2`：`--paper #F3F5F1`、`--green #16735C`、`--amber #955B12`、`--red #B54141`；触控区 ≥44px；状态均带符号+文字。

## 5 验证证据

### 5.1 自动化测试（63/63）

```
M1：42 项（契约 3 + fixtures 13 + 专项 10 + 状态机 10 + API 1 + 插件 4 + 存储保留 1）
M2：21 项（配对 4 + 网关 7 + 推送 2 + 通知 2 + store 2 + PWA 4）
```

日志：`docs/evidence/m2/tests.log`。

### 5.2 真实端到端（`npm run m2:e2e`）

```text
health: upstream ok
pair_session: code 68684477, 5 分钟有效
pair_request: pending
pair_confirm: confirmed（设备 M2 E2E iPhone）
pair_poll: confirmed, token_prefix dsw_WahT…
tasks: 200, count 5, states {running:1, succeeded:4}
unauthorized: 401 unauthorized
pwa: index 200（含 DSH WATCH）、manifest 200（DSH Watch）、sw 200（含 push）
device: M2 E2E iPhone
```

证据：`docs/evidence/m2/e2e.json`、`docs/evidence/m2/e2e-console.txt`。

### 5.3 通知轮询

网关运行中 `watcher.polls` 持续增长（实测 1179 次）、`failures=0`；本机任务状态变化触发 1 次通知意图（无订阅时只记录不投递）。`GET /v1/health` 显示 `upstream.ok=true`。

### 5.4 Web Push

- `webpush.generateRequestDetails`：`Authorization: vapid t=…`、`Content-Encoding: aes128gcm`、密文长度 >100 且不含明文任务 id（`push.test.mjs`）。
- `PushService`：成功计数、410 失效订阅删除（测试通过）。

### 5.5 cloudflared 隧道（V07，已实测）

- 安装：`winget install --id Cloudflare.cloudflared`（本机安装 2026.11.0，零账号、零费用）。
- 启动：`node packages/gateway/bin/tunnel.mjs`（自动使用 `.data/bin/cloudflared.exe` 或 PATH）。
- 生成地址：`https://bigger-ultimate-pair-vincent.trycloudflare.com`
- 验证：
  - 公网 `GET /v1/health` → 200，`upstream.ok=true`；
  - `/`、`/manifest.webmanifest`、`/sw.js`、`/icons/icon-192.png` → 全部 200；
  - 经隧道调用 `POST /v1/pair/sessions` → **403**（管理接口仅 loopback，隧道请求带 `cf-connecting-ip` 被拒绝）；
  - 无头 Chrome（iPhone 390×844 视口）打开隧道 `/pair`：`isSecureContext=true`、Service Worker `registered:https://bigger-...trycloudflare.com/`、manifest/apple-touch-icon/apple-mobile-web-app-capable 均存在。
  - Chrome `Page.getAppManifest`：**manifestErrors=[]**；`Page.getInstallabilityErrors`：**installabilityErrors=[]**（PWA 安装前置无错误）。
- 证据：`docs/evidence/m2/tunnel-health.json`、`docs/evidence/m2/tunnel-check.json`、`docs/evidence/m2/installability.json`、`docs/evidence/panel/m2-tunnel-pair.png`。
- 限制：quick tunnel 地址随机、无 SLA；进程结束即失效。真机 iPhone 仍需在 Safari 打开该 HTTPS 地址并“添加到主屏幕”。

### 5.6 V06 iPhone 到达率（已实测）

- 设备：iPhone 17 Pro Max / iOS 27.0.1，主屏幕独立 PWA（Safari 配对后主屏幕 App 二次配对，设备 `dev_f096…`）。
- 20 次触发：`v06-20-233821`，混合 succeeded/failed/waiting_input/waiting_approval，发送 **20/20 成功，0 失败**，平均 424ms。
- iPhone 侧：锁屏收到 DSH Watch 分组通知，图标角标 **23**（3 条既有 + 20 条新测试）；App 提醒记录 **23 条未读**，类型完整覆盖。
- **到达率：20/20 = 100%（目标 ≥18/20）**；隐私模式锁屏不显示任务内容。
- 结果文档：`docs/V06-ACCEPTANCE-RESULT.md`；截图：`docs/evidence/m2/v06-lockscreen.jpg`、`v06-reminders-1..5.*`、`v06-notification-center-24.jpg`、`v06-detail-from-notification.jpg`；发送证据：`docs/evidence/m2/v06-push-test.json`、`v06-20-console.txt`。
- 点击详情：✅ 通过（点击真实任务通知进入对应任务详情，顶部显示“由提醒进入 · 触发原因：任务完成”）。
- 补充：iPhone 型号/iOS 版本 = **iPhone 17 Pro Max / iOS 27.0.1**。

## 6 未完成 / 外部项

1. **V06：iPhone 添加到主屏幕 + Web Push 到达率：✅ 已通过（20/20，100%）**；点击详情 ✅；详见 `docs/V06-ACCEPTANCE-RESULT.md`。
2. **V07：cloudflared 免费隧道：✅ 已完成**（见 §5.5）。quick tunnel 地址随机、无 SLA，仅用于验证/临时使用。
3. **HTTPS 自签证书路径**：网关支持 `--tls-cert/--tls-key`，本机未生成自签证书；V07 的 cloudflared HTTPS 已覆盖真机链路。
4. **真机通知权限/安装引导：✅ 已完成**（主屏幕安装 + 通知允许 + 20 次到达）。
5. **PWA 提醒记录清理策略**：IndexedDB 已实现；默认不自动删除（可后续加）。

## 7 运行手册

```bash
cd dsh-mobile-watch
npm run gateway                       # 网关 8787（默认状态 ~/.dsh/dsh-watch-gateway/state.json）
npm run pair                          # 另开终端，扫码/输入 8 位码，电脑按 y
# 手机 Safari 打开配对链接；本机调试 http://127.0.0.1:8787/
# iPhone：npm run tunnel 得到 https 地址后再添加到主屏幕并允许通知
```

真机 iPhone 步骤：`npm run tunnel` → iPhone Safari 打开 `https://<随机>.trycloudflare.com/pair` → 输入码 → 电脑确认 → 分享 → 添加到主屏幕 → 允许通知 → 设置页开启通知。

## 8 下一步

1. **M2 已完成**：V06/V07 均通过，验收记录在 `docs/V06-ACCEPTANCE-RESULT.md`。
2. 进入 **M3 原生展示版**：复用同一契约与 m1-v1.1 API，按设计 Token 实现 SwiftUI 局域网客户端。
