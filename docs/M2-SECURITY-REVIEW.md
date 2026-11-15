# M2 安全复查（P0）

日期：2026-11-15｜范围：`dsh-watch-gateway`、PWA、配对/凭证、Web Push、本地状态。

## 1 结论

未发现高危阻断项；M2 的**单用户、本机、本机隧道**边界成立。已补 3 个响应头与 1 个仅 loopback 的隧道地址登记接口；剩余风险为可接受的单机模型风险。

## 2 检查表

| # | 项目 | 现状 | 结论 |
| --- | --- | --- | --- |
| 1 | 配对管理接口 | `POST /v1/pair/sessions`、`GET /v1/pair/sessions/{id}`、`POST .../confirm`、`POST /v1/admin/tunnel-url` 均要求 `isLoopback()`；带 `cf-connecting-ip`/`x-forwarded-for` 的请求拒绝 | ✅ |
| 2 | 设备凭证 | `dsw_` + 24 字节随机；state.json 只存 sha256；撤销即失效并清订阅 | ✅ |
| 3 | 配对码 | 8 位数字、5 分钟、每会话最多 5 个请求、按 IP 60/min 限速 | ✅（残余：跨 IP 分布式尝试未做全局配额） |
| 4 | VAPID 密钥 | 首次生成，存 `~/.dsh/dsh-watch-gateway/state.json`；尝试 0600 | ⚠️ Windows ACL 不保证 0600，属本机文件权限残余风险 |
| 5 | 推送 payload | 仅 `{v,kind,task,event,at}`，不含标题/摘要/路径；服务端不保存提醒记录 | ✅ |
| 6 | Web Push 订阅 | 需 Bearer 设备 token；订阅 endpoint/keys 存本机；404/410 自动清理 | ✅ |
| 7 | HTTP 头 | 已加 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`；PWA 有 CSP | ✅ |
| 8 | 代理/隧道 | cloudflared 仅转发到本机 8787；管理接口通过代理头判定为外部，已实测隧道 POST 返回 403 | ✅ |
| 9 | XSS/存储 | 前端对任务标题/摘要做 `esc()`；token 存 localStorage（本机 PWA） | ⚠️ XSS 残余由 CSP/自建单页控制；M3 可考虑更严格存储 |
| 10 | 日志/隐私 | 网关日志只记任务 id 前 18 位与 kind；不记 payload 内容 | ✅ |
| 11 | 数据保留 | 插件 30 天（事件/终态任务）；PWA 30 天（提醒/终态缓存）；网关 notified 7 天 | ✅ |
| 12 | 依赖 | `web-push`（MIT）、`qrcode`（MIT）；无付费/云服务 | ✅ |

## 3 P0 修复

- 响应头三项（见上表 #7）。
- `POST /v1/admin/tunnel-url` 仅 loopback，带代理头拒绝；只接受 `https://`。
- Push 重试 + 404/410 清理，失败通知保留重试，不丢事件。
- 数据保留与 PWA 清理，减少本地数据长期堆积。

## 4 残余风险（接受/后续）

1. **单用户边界**：网关无多用户/角色；设备 token 即全部权限。M2 的产品边界是单用户一台电脑。
2. **quick tunnel 公网地址**：地址随机但公开；配对码是唯一入口，配对管理接口不暴露。建议用完关闭隧道。
3. **state.json ACL**：Windows 上 0600 语义弱，依赖用户目录权限；不要把该文件复制到共享目录。
4. **localStorage token**：若 PWA 出现 XSS 可被读取；当前自建静态页 + CSP + esc() 降低风险，M3 可迁移到更安全存储/短期 token。
5. **依赖供应链**：`web-push`/`qrcode` 来自 npm；建议锁定版本与 CI 审计（后续）。
