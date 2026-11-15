# 给 AI 的整包部署说明（AI-DEPLOY）

> 目标读者：拿到 `dsh-mobile-watch` 整个文件夹的 AI 编码代理。  
> 目标：在用户电脑上完成 DSH 插件、网关、PWA 的部署并验证；**不修改 DSH 源码，不碰 `ui-theme` 等 UI 插件，不读取/写入凭证**。

## 0 先读

按顺序读：

1. `README.md`
2. `docs/DEPLOYMENT.md`
3. `docs/M2-P0-HARDENING.md`（安全/自启）
4. `docs/M4-A-REPORT.md` / `docs/M4-B-REPORT.md`（审批/问答接口）
5. `docs/M4-EDGE-TEST-PLAN.md`（边界测试；默认不执行）

## 1 环境检查

```powershell
node --version
Get-Command dsh -ErrorAction SilentlyContinue
Test-Path "$env:USERPROFILE\.dsh\profiles\desktop"
```

要求：

- Node 24+；
- DSH Desktop 至少启动过一次；
- 不要直接编辑 `~/.dsh/profiles/desktop/cordis.patch.yml` 去禁用 UI 插件；
- 若需要安装系统软件（cloudflared/Sideloadly），先向用户申请，不要静默安装。

## 2 依赖与测试

```powershell
Set-Location <repo-root>
npm install --prefix packages/gateway
npm test
```

必须看到测试全部通过；若失败，先停止并报告，不要继续部署。

## 3 安装/启用 dsh-watch

优先用 DSH 插件管理器安装本地目录 `packages/dsh-watch`；若用户已有 `file:` 依赖，确认 profile 的 `dsh.profile.bundles` 包含 `dsh-watch`，然后重启 DSH。

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:7317/v1/health
```

失败时检查 DSH 是否启动、插件是否启用；不要通过禁用其他插件来“修复”。

## 4 启动网关

```powershell
Set-Location <repo-root>
.\scripts\start-m2.cmd
Invoke-RestMethod http://127.0.0.1:8787/v1/health
```

注意：

- `start-m2.cmd` 是幂等的；已在运行会跳过；
- 需要 M3 局域网演示时才使用 `scripts\start-m3-lan.cmd`，它会改绑 `0.0.0.0:8787`，演示后恢复 `start-m2.cmd`。

## 5 隧道与 PWA 配对

```powershell
npm run tunnel
npm run pair
```

- 把 tunnel URL 和 8 位配对码交给用户；
- 用户在 iPhone Safari 打开根地址 → 添加到主屏幕 → 打开新图标 → 输入配对码；
- 用户在设置中开启通知；
- 验证 gateway health 中 `subscriptions` 至少 1。

不要读取或输出用户的 Apple ID、API key、device token 或 `.dsh` 下的凭证文件。

## 6 验证清单

- [ ] `GET http://127.0.0.1:7317/v1/health` 返回 `ok=true`
- [ ] `GET http://127.0.0.1:8787/v1/health` 返回 `upstream.ok=true`
- [ ] PWA 任务列表能加载
- [ ] PWA 任务详情显示状态/轨迹/费用“暂无数据”/子代理
- [ ] 测试推送 `sent >= 1`
- [ ] 如果测试 M4：审批卡/问答卡可显示，手机提交后 action `decision=mobile`

## 7 错误处理

| 错误 | 处理 |
| --- | --- |
| 7317 无响应 | 插件未启用/DSH 未启动；重启 DSH，不要动 UI 插件 |
| 8787 无响应 | 端口占用；停掉旧进程后运行 `scripts\start-m2.cmd` |
| DSH 启动崩溃 | 从 profile patch 备份恢复；**不要禁用 `ui-theme`** |
| tunnel 地址变化 | 旧 PWA 失效；重新添加主屏幕并配对 |
| 通知没有 | 检查 PWA 通知权限、`subscriptions`、iOS 设置 |

## 8 禁止事项

- 不修改 `01_交付物/`；
- 不修改 DSH 源码、原始 `~/.dsh/sessions` 日志；
- 不把 API key、token、`.dsh/.credentials.yaml` 写入仓库或输出到聊天；
- 不为测试关闭 `ui-theme`、`ui-layout`、`ui-sidebar`、`ui-chat`；
- 不执行 `docs/M4-EDGE-TEST-PLAN.md` 的隔离测试，除非用户逐项确认。

## 9 交付报告

部署完成后向用户报告：

- 使用的仓库路径/commit；
- 7317/8787 health；
- PWA 配对设备数、subscriptions；
- tunnel 地址（提醒用户 quick tunnel 会变化）；
- 未完成项和风险。
