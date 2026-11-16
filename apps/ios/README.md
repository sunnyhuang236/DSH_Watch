# DSHWatch（M3 原生签名版）

SwiftUI iOS 17+ 局域网展示版：配对、任务列表、任务详情、提醒记录、设置；复用 `m1-v1.1` 契约与设计 Token。**已补齐 M4 的任务详情审批/问答/轨迹/费用/子代理；不含 Web Push/APNs。**

## 构建（Windows 无 Xcode 时）

1. 把仓库推到 GitHub（私有或公开均可；Actions 免费额度足够）；
2. 打开 Actions → **Build DSHWatch unsigned IPA** → Run workflow；
3. 下载 artifact `DSHWatch-unsigned-ipa`（内含 `DSHWatch-unsigned.ipa`）；
4. Windows 用 **Sideloadly** 连接 iPhone，拖入 IPA，用免费 Apple ID 签名安装（7 天有效）；
5. 在 iPhone 设置 → 通用 → VPN 与设备管理 → 信任你的开发者证书。

> 若本地有 macOS/Xcode：`brew install xcodegen && cd apps/ios && xcodegen generate`，打开 `DSHWatch.xcodeproj` 运行。

## 使用

1. 电脑先运行 `scripts\start-m3-lan.cmd`（网关绑定 0.0.0.0:8787），再运行 `npm run pair`；
2. iPhone 与电脑同一 Wi-Fi；打开 DSHWatch，输入电脑局域网地址（例如 `http://192.168.1.100:8787`）和 8 位配对码；
3. 电脑终端按 `y` 确认；App 进入任务列表；
4. 演示路径：配对 → 任务列表 → 任务详情 → 提醒记录（60 秒）。

## 边界

- 仅局域网，HTTP（`NSAllowsLocalNetworking`）；不包含 Web Push/APNs。
- 数据缓存 `Application Support/DSHWatch`；device token 存 Keychain。
- 免费签名 7 天到期后需重新用 Sideloadly 签名。
