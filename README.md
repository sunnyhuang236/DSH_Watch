# dsh-mobile-watch（M1–M4 完成）

DSH 移动盯梢器的代码仓库：电脑上运行 DSH 长任务，手机随时知道任务是否需要你介入。

> 朋友安装看 **[INSTALL.md](INSTALL.md)**；只要 Node.js + DSH Desktop，双击 `install.cmd`，重启 DSH，再双击 `start-dsh-watch.cmd`。

- **M1 数据管道**：`dsh-watch` 插件订阅 DSH 事件 → 归一化 → 状态机 → SQLite → 只读 `/v1` API + 调试面板；契约 **m1-v1.1 已冻结**，42 项测试、13 份回归样本、真实 DSH 0.2.2-rc.1 内加载与重启自动加载已验证。
- **M2 可用版**：`dsh-watch-gateway`（配对 / 设备凭证 / `/v1` 反代 / PWA 托管 / VAPID Web Push / cloudflared 隧道）+ PWA（配对/任务/详情/提醒/设置、Service Worker、安装引导、缓存）；21 项网关测试 + 本地 E2E + **iPhone 17 Pro Max 真机 V06 20/20 到达（100%）**。
- **M3 展示版（已完成）**：`apps/ios/DSHWatch` SwiftUI 源码 + XcodeGen + GitHub Actions 未签名 IPA + Sideloadly 真机安装；任务列表/详情/提醒记录/断网缓存与 iPhone 热点局域网直连均已验证（7 天免费签名到期续签为未来维护项）。
- **M4-A 手机审批（真机通过）**：插件审批桥 + 网关 `/v1/actions` + PWA 审批卡片；手机点击“允许一次”后 `decision=mobile / outcome=allowed-once`，任务恢复运行。
- **M4-B 问答桥（真机通过）**：插件 `user-questions/request` 桥 + PWA 问答卡片；71/71 测试通过，手机选择「手机回答」后 `decision=mobile`、`status=answered`，DSH 工具收到答案并继续。
- **M4-C 轨迹/费用/子代理（真机通过）**：轨迹按轮次折叠、最近/异常展开；费用缺失显示“暂无数据”；子代理数量/深度/状态展示，缓存升级 `dsh-watch-v7`。

```
packages/dsh-watch/     DSH 插件：订阅事件 → 归一化 → 状态机 → SQLite → /v1 API + 调试面板
packages/gateway/       M2 网关：配对、设备 token、反代 /v1、PWA 托管、Web Push、可选隧道
apps/web/               M2 PWA：配对/任务列表/任务详情/提醒记录/设置 + sw.js + manifest + 图标
apps/ios/               M3 SwiftUI 展示版（DSHWatch，GitHub Actions 出未签名 IPA）
contract/               冻结契约 m1-v1.1（JSON Schema + 说明）
tools/                  回放/tail、专项样本、样本普查、M2 端到端与截图工具
fixtures/               M0/M1 回归样本（真实 + 合成 + 外部依据，含 provenance）
docs/                   M1/M2 报告、V05 验收、冻结记录、证据
```

## 最简安装（给朋友）

前置：Windows + Node.js 24 LTS + DSH Desktop（至少启动过一次）。

1. 双击 **`install.cmd`**：自动安装网关依赖、运行测试、把 `dsh-watch` 装进 DSH profile；
2. 重启 DSH Desktop；
3. 双击 **`start-dsh-watch.cmd`**：自动启动网关和 cloudflared，并进入手机配对；
4. 手机按终端提示添加主屏幕、输入配对码。

如果 DSH 是 Web profile，安装时用：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-dsh-watch.ps1 -Profile web
```

手动部署细节见 `docs/DEPLOYMENT.md`，装好后的使用见 `docs/USER-GUIDE.md`。

## 快速开始

M1（只看任务数据，不配对）：

```bash
cd dsh-mobile-watch
npm test                         # 71 项：M1 42 + M2 21 + M4 8
npm run audit:fixtures           # 脱敏审计（13 文件 / 0 违规）
node tools/replay-logs.mjs       # 回放 → 浏览器 http://127.0.0.1:7317/
```

M2（网关 + PWA）：

```bash
cd dsh-mobile-watch
npm install --prefix packages/gateway     # 首次：web-push + qrcode（MIT）
npm run gateway                           # 网关 http://127.0.0.1:8787
npm run pair                              # 另开终端：打印二维码/8 位码并等待手机
# 手机 Safari 打开配对链接（或 http://<电脑IP>:8787/pair）
```

> 真机 iPhone 使用 Web Push 需 **HTTPS + 添加到主屏幕**：用 `npm run tunnel`（需安装 cloudflared）或给 `--tls-cert/--tls-key`。本机 `127.0.0.1` 可直接调试 PWA。

## 文档

| 文档 | 内容 |
| --- | --- |
| `docs/M1-REPORT.md` / `docs/M1-FREEZE.md` | M1 数据管道报告与契约冻结记录 |
| `docs/V05-ACCEPTANCE.md` | 真实 DSH 内加载/重启验收 |
| `docs/V06-ACCEPTANCE-TEMPLATE.md` | iPhone 主屏幕 + Web Push 到达率验收模板（已执行） |
| `docs/V06-ACCEPTANCE-RESULT.md` | V06 实机结果：20/20 到达（100%）+ 截图/发送证据 |
| `docs/M2-REPORT.md` | M2 网关 + PWA 报告与验收记录 |
| `docs/M2-P0-HARDENING.md` / `docs/M2-SECURITY-REVIEW.md` | P0 生产化硬化与安全复查 |
| `docs/P0-SUMMARY.md` | P0 一页汇总（六项交付、实测时间线、当前状态） |
| `docs/M3-REPORT.md` / `docs/M3-DEMO-CHECKLIST.md` | M3 原生展示版报告与 60 秒演示清单 |
| `docs/M4-A-REPORT.md` / `docs/M4-B-REPORT.md` / `docs/V03-APPROVAL-CAPABILITY.md` | M4 手机审批、问答桥与 V03 核查 |
| `docs/M4-C-REPORT.md` | M4-C 轨迹/费用/子代理展示 |
| `docs/M4-EDGE-TEST-PLAN.md` | M4 拒绝/冲突安全测试方案（独立 profile，默认不执行） |
| `docs/DEPLOYMENT.md` / `docs/AI-DEPLOY.md` | 人工部署指南 + 给 AI 的整包部署说明 |
| `docs/USER-GUIDE.md` | 装好之后怎么用（手机配对、通知、任务详情、审批/问答、常见问题） |
| `docs/PRODUCT-DIFFERENTIATORS.md` | 产品差异化要点（状态语义/通知质量/工程证据/M4 hooks） |
| `docs/evidence/` | 测试、样本、E2E、截图等证据 |

## 安全约束

- 本机运行、零服务器；PWA 只通过配对设备 token 访问 `/v1`。
- 设备 token 只存 sha256；配对码 5 分钟、每会话 5 次、按 IP 限速；配对管理只接受 loopback。
- 推送 payload 只含不透明任务引用与通用 kind，不含标题/摘要/路径；锁屏内容默认隐藏。
- 不改 DSH 源码、不删已装插件、不改 `~/.dsh/sessions` 原始日志；不写凭证、不上传数据。
