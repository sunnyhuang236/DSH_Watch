# DSH Watch 项目入口

## 快速入口

- **项目介绍 Word**：`docs/DSH-Watch-项目介绍.docx`（PDF 预览：`docs/DSH-Watch-项目介绍.pdf`）
- **朋友安装**：`INSTALL.md`，双击 `install.cmd` → 重启 DSH → 双击 `start-dsh-watch.cmd`
- **人工部署**：`docs/DEPLOYMENT.md`
- **AI 部署**：`docs/AI-DEPLOY.md`
- **装完怎么用**：`docs/USER-GUIDE.md`
- **代码结构**：`packages/dsh-watch`（DSH 插件）、`packages/gateway`（网关）、`apps/web`（PWA）、`apps/ios`（M3 SwiftUI）

## 当前状态

- M0–M4 核心完成：任务盯梢、手机通知、手机审批、手机问答、轨迹/费用/子代理
- 测试：71/71 通过
- M2 推送验收：V06 20/20 到达
- M4 边界：拒绝、桌面先允许→conflict、插件重启 expired 全部通过
- 零服务器：本机网关 + 可选 cloudflared quick tunnel

## 仓库

https://github.com/sunnyhuang236/DSH_Watch