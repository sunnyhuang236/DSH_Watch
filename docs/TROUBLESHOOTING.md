# 故障排查（Troubleshooting）

## 症状 → 处理速查

| 症状 | 最可能原因 | 处理 |
| --- | --- | --- |
| 手机 PWA 打开后跳到配对页 / 提示 unauthorized | 设备被撤销（隧道地址变化会自动撤销旧设备） | 跑 `scripts\repair-pair.cmd` 重新配对 |
| `curl 127.0.0.1:8787/v1/health` 里 `devices: 0` | 同上；或从未配对 | `repair-pair.cmd` |
| `subscriptions: 0`（但 devices ≥ 1） | PWA 没开通知，或订阅被 410/404 清理 | PWA 设置 → 开启通知；确认 iOS 通知权限 |
| 收不到锁屏推送 | tunnel 变了 / 未添加到主屏幕 / 通知权限关闭 | 见下面“推送检查顺序” |
| M3 App 一直转圈或报错 | 网关没起 / 手机不在同一 Wi-Fi / 地址写错 | `start-m3-lan.cmd`；用 `ipconfig` 的 IPv4；`http://IP:8787` |
| M3 App 提示“设备已失效，请重新配对” | 设备被撤销 | 重新配对（App 会自动回到配对页） |
| 7317 不通 | dsh-watch 插件没启用 | 重启 DSH，确认插件启用 |

## 为什么 devices 会变成 0

网关的安全设计：**当前访问地址（public_url）变化时，会撤销所有旧设备并清空推送订阅**，避免旧地址的“幽灵通知”。

副作用：cloudflared quick tunnel 每次重启都会拿到新域名 → 自动撤销 → 必须重新配对。

查看真实数量：

```powershell
curl http://127.0.0.1:8787/v1/health
# devices          当前有效设备
# devices_total    历史设备总数
# devices_revoked  已撤销数量
# subscriptions    当前推送订阅数
```

## 推送检查顺序

1. `curl http://127.0.0.1:8787/v1/health` → `ok:true` 且 `upstream.ok:true`；
2. `devices >= 1`（否则先 `repair-pair.cmd`）；
3. 手机 PWA 必须**从主屏幕图标打开**（Safari 标签页不算）；
4. PWA 设置 → 通知权限 = 已允许；
5. PWA 设置 → 点“开启通知” → 再查 `subscriptions >= 1`；
6. 若仍为 0：iOS 设置 → 通知 → DSH Watch → 允许；必要时删除主屏幕图标重新添加并配对。

## 隧道地址变化之后

quick tunnel 地址是临时的，重启即变。地址变化后：

1. 旧 PWA/旧配对全部失效（正常）；
2. 电脑重新 `npm run tunnel` 得到新地址；
3. 手机用**新地址**重新“添加到主屏幕”→ 配对 → 开通知；
4. 或直接跑 `scripts\repair-pair.cmd`（局域网模式，适合 M3 演示）。

## 测试前 30 秒自检

```powershell
curl http://127.0.0.1:7317/v1/health   # dsh-watch 插件
curl http://127.0.0.1:8787/v1/health   # 网关
```

两个都 `ok:true`，且 8787 的 `devices >= 1`，就可以开始测。
