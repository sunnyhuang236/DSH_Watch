# M3 原生展示版报告（SwiftUI，局域网）

日期：2026-11-15｜代码：`apps/ios/DSHWatch`

## 0 结论

M3 的 **SwiftUI 源码、XcodeGen 工程、GitHub Actions 未签名 IPA、Sideloadly 真机安装、任务列表/详情/提醒记录/断网缓存验证均已完成**；图标版由 run `43691453164` 构建成功并在 iPhone 上确认显示正常。AC13 的 7 天到期续签属于未来维护项，不影响本次展示版交付。

| 项 | 状态 |
| --- | --- |
| SwiftUI 工程（配对/列表/详情/提醒/设置） | ✅ 源码完成 |
| 复用 m1-v1.1 契约（TaskSnapshot/TaskEvent/Health） | ✅ 模型与 API 对齐 |
| 设计 Token | ✅ `Theme.swift` 对齐 DESIGN_HANDOFF §2 |
| 离线缓存 | ✅ Application Support JSON + 启动加载 |
| 设备 token | ✅ Keychain |
| GitHub Actions 构建未签名 IPA | ✅ workflow 已写（`.github/workflows/ios-ipa.yml`） |
| 本地 Xcode 编译 | ⏳ 本机无 macOS/Xcode；已由 GitHub Actions 编译 |
| GitHub Actions 构建 | ✅ run 43685652337 success，未签名 IPA 已下载 |
| 真机安装/7 天免费签名（AC13） | ✅ Sideloadly 免费签名安装成功；7 天到期续签待未来执行 |
| 60 秒演示（AC14） | ✅ 任务列表→详情→提醒记录已走通；iPhone 热点局域网直连通过 |
| 断网缓存（AC15） | ✅ 断网显示缓存与最后同步时间，不崩溃 |

## 1 交付物

| 路径 | 内容 |
| --- | --- |
| `apps/ios/DSHWatch/DSHWatchApp.swift` | App 入口 |
| `apps/ios/DSHWatch/Models.swift` | m1-v1.1 模型（TaskSnapshot/TaskEvent/Pairing/Reminder） |
| `apps/ios/DSHWatch/APIClient.swift` | URLSession API（`/v1/tasks`、`/v1/tasks/{id}`、`/events`、配对） |
| `apps/ios/DSHWatch/AppStore.swift` | 状态、缓存、提醒记录、Keychain token |
| `apps/ios/DSHWatch/Keychain.swift` | 设备 token 安全存储 |
| `apps/ios/DSHWatch/Theme.swift` | 设计 Token + 状态颜色/符号/文案 |
| `apps/ios/DSHWatch/Views/*.swift` | 配对/任务列表/详情/提醒/设置 |
| `apps/ios/project.yml` | XcodeGen 工程（iOS 17+，局域网 ATS 例外） |
| `.github/workflows/ios-ipa.yml` | macOS runner 构建未签名 IPA |
| `apps/ios/README.md` | 构建 + Sideloadly 安装说明 |

## 2 技术要点

- **同一契约**：字段名按 `m1-v1.1`（`task_id`、`run_id`、`state`、`waiting`、`token_usage` 等），直接解码网关 `/v1`。
- **配对**：输入电脑局域网地址 + 8 位配对码 → `/v1/pair/requests` → 轮询 → Keychain 保存 device token；电脑端 `npm run pair` 确认。
- **离线**：启动先读 `Application Support/DSHWatch/tasks.json`，刷新失败保留缓存并显示最后同步时间。
- **提醒记录**：App 内轮询状态迁移生成本地提醒（M3 无推送），30 天保留。
- **设计**：`Theme.swift` 使用 `#182C30/#607476/#F3F5F1/#16735C/#955B12/#B54141` 等 Token；状态均带符号+文字。
- **不含**：Web Push/APNs（免费签名无 push entitlement）；**已含**：M4 的手机审批、手机问答、轨迹折叠、费用“暂无数据”、子代理信息展示。

## 3 构建步骤

0. 真机演示前，电脑运行 `scripts\start-m3-lan.cmd`，让网关监听 `0.0.0.0:8787`（默认 P0 网关只绑定 127.0.0.1，iPhone 局域网访问不到）；
1. IPA 已由 GitHub Actions 生成（见 §4.1），无需本地 Xcode；
2. Actions → `Build DSHWatch unsigned IPA` → Run workflow；
3. 下载 artifact `DSHWatch-unsigned-ipa`；
4. Windows 用 Sideloadly + 免费 Apple ID 签名安装（7 天有效）；
5. 真机信任证书后打开 App。

## 4 验收结果（AC13–AC15）

- **AC13**：✅ 免费 Apple ID 自签安装成功；7 天有效期已开始，到期重签待未来执行；
- **AC14**：✅ iPhone 热点下电脑连热点（172.20.10.4:8787）直连，任务列表/详情/提醒记录 60 秒路径走通；
- **AC15**：✅ 断网打开显示缓存和最后同步时间，不崩溃。

> 首次 GitHub Actions 构建会暴露 Swift 编译问题；当前 Windows 无 Xcode，无法本地 `swiftc` 验证。建议先跑一次 CI，把编译错误修完再上真机。

## 5 下一步

1. 建 GitHub 仓库并运行 workflow；
2. 根据 CI 编译日志修 Swift 错误；
3. Sideloadly 真机安装，按 `docs/M3-DEMO-CHECKLIST.md` 录 60 秒演示并截 5 张图。
