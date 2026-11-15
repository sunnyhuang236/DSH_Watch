# dsh-watch-gateway（M2）

配对 + 设备凭证 + `/v1` 反代 + PWA 静态托管 + VAPID Web Push + 可选 cloudflared 隧道；零服务器、零账号。

## 启动

```bash
cd packages/gateway && npm install
node bin/gateway.mjs        # http://127.0.0.1:8787
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 监听地址；局域网用 `0.0.0.0` |
| `--port` | `8787` | 端口 |
| `--upstream` | `http://127.0.0.1:7317` | dsh-watch 插件 |
| `--state` | `~/.dsh/dsh-watch-gateway/state.json` | VAPID/设备哈希/订阅 |
| `--public-url` | 自动局域网 IP | 配对链接/二维码地址 |
| `--tls-cert` / `--tls-key` | — | HTTPS（iOS PWA/Web Push 必需） |
| `--no-watch` | — | 关闭通知轮询（调试） |

## 配对

电脑 `node bin/pair.mjs` → 打印二维码/链接/8 位码；手机 Safari 打开链接输入码；电脑按 `y` 确认；手机拿到设备 token。

## API

`GET /v1/health`、`GET /v1/push/public-key` 公开；`POST /v1/pair/sessions`、`GET /v1/pair/sessions/{id}`、`POST .../confirm` 仅 loopback；`POST /v1/pair/requests`、`GET /v1/pair/requests/{id}?token=` 手机配对；`GET /v1/tasks*`、`GET/DELETE /v1/devices/current`、`POST /v1/push/subscribe|unsubscribe` 需 Bearer。

## 安全

配对管理只接受 loopback（带 `cf-connecting-ip`/`x-forwarded-for` 的隧道请求不算）；设备 token 只存 sha256；配对码 5 分钟/每会话 5 次/IP 限速；推送 payload 不含标题摘要。

## 测试

`npm test`（20 项：配对/鉴权/反代/推送/通知/静态资源）。
