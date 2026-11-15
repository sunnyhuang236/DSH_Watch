# M3 真机验收记录（2026-11-15）

## 结论

M3 SwiftUI 展示版已完成 **编译 → Sideloadly 免费签名安装 → Developer Mode 启动 → 任务列表 → 任务详情 → 提醒记录** 实机验证。  
本次 UI 验证使用 iPhone 个人热点，电脑连热点后通过 `http://172.20.10.4:8787` 直连完成；**AC14 纯局域网已通过**。

## 结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 编译（GitHub Actions） | ✅ run 43685652337 success | 未签名 IPA |
| 安装（Sideloadly v0.72） | ✅ 安装完成（100% / Done）；免费 Apple ID | `m3-install` 记录 |
| Developer Mode | ✅ 开启并重启 iPhone | 用户确认 |
| 任务列表 | ✅ 6 条任务（1 运行中 / 5 最近结束） | `docs/evidence/m3/m3-task-list.jpg` |
| 任务详情 | ✅ 状态、步骤、时间、执行 ID、token 用量、事件 | `docs/evidence/m3/m3-task-detail.jpg` |
| 提醒记录 | ✅ 1 条任务完成提醒（未读） | `docs/evidence/m3/m3-reminders.jpg` |
| AC14 纯局域网 | ✅ iPhone 热点，电脑连热点，`http://172.20.10.4:8787` 直连；任务列表正常 | `docs/evidence/m3/m3-lan-task-list.jpg` |
| AC15 断网缓存 | ✅ 断网后显示缓存任务/最后同步时间，不崩溃 | `docs/evidence/m3/m3-offline-cache.jpg` |

## 已知问题

1. AppIcon 已补 `apps/ios/DSHWatch/Assets.xcassets/AppIcon.appiconset`（1024×1024），run 43691453164 构建并重装后显示正常。
2. 提醒时间 `in 0 sec.` 是 `RelativeDateTimeFormatter` 的英文文案，可改为“刚刚”（非阻断）。
3. 校园网 `gdut` 有 AP 隔离；M3 已改用 iPhone 热点局域网验证通过（172.20.10.4:8787）。
4. 新隧道地址变化后 PWA 旧订阅被清空，M3 测试后需要重新配对 PWA。

## 截图

- `docs/evidence/m3/m3-task-list.jpg`
- `docs/evidence/m3/m3-task-detail.jpg`
- `docs/evidence/m3/m3-reminders.jpg`
