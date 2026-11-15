# V06 验收结果：iPhone 主屏幕 + Web Push 到达率

- 日期：2026-11-14 23:25–23:50（Asia/Shanghai）
- 结论：**到达率 20/20（100%），超过 ≥18/20 目标**；锁屏通知、App 提醒记录与点击详情均验证；设备 iPhone 17 Pro Max / iOS 27.0.1。
- 关联：`docs/V06-ACCEPTANCE-TEMPLATE.md`、`docs/M2-REPORT.md`

## 0 环境

| 项 | 值 |
| --- | --- |
| iPhone 型号 / iOS 版本 | **iPhone 17 Pro Max / iOS 27.0.1**（用户提供） |
| 浏览器 | Safari（Safari 标签页配对后，用主屏幕独立 App 二次配对） |
| 网络 | Wi-Fi（截图状态栏显示 Wi-Fi + 中国移动） |
| 电脑 DSH | 0.2.2-rc.1 |
| dsh-watch 插件 | 0.1.0（任务/事件在 7317） |
| gateway | 0.1.0（8787） |
| 隧道 | cloudflared 2026.11.0，`https://bigger-ultimate-pair-vincent.trycloudflare.com` |
| 最终设备 | `dev_f09671c0c84e73d2`，名称“iPhone” |

## 1 前置检查

| 检查 | 结果 |
| --- | --- |
| 插件 `/v1/health` | ✅ ok=true |
| 网关 `/v1/health` | ✅ ok=true，upstream.ok=true |
| 隧道 HTTPS / PWA / SW | ✅ 通过（见 M2-REPORT §5.5） |

## 2 配对 + 安装

| 检查项 | 结果 |
| --- | --- |
| Safari 配对（第一次） | ✅ 成功（设备“我的iPhone”，Safari 与会话存储独立） |
| 主屏幕 App 内二次配对 | ✅ 成功（设备“iPhone”，自动确认） |
| 添加到主屏幕 | ✅ 已安装，独立窗口（截图 `v06-reminders-1.png` 无 Safari 地址栏） |
| 通知权限 | ✅ 已允许（订阅 endpoint 为 Apple Web Push） |

## 3 基准通知

| 检查 | 结果 |
| --- | --- |
| 单条测试推送 | ✅ 收到；锁屏/通知中心显示“DSH Watch / 打开 DSH Watch 查看详情” |
| 提醒记录写入 | ✅ 23:36 记录可见 |

## 4 20 次触发

- 触发批次：`v06-20-233821`；发送时间 23:38:25–23:39:01
- 类型：succeeded / failed / waiting_input / waiting_approval 混合（各 4 条，顺序循环）
- 发送结果：**20/20 sent，0 failed，0 removed**；平均发送耗时 424ms
- iPhone 侧：
  - 锁屏通知：DSH Watch 分组通知（iOS 折叠为一组）+ 图标角标 **23**
  - App 提醒记录：**23 条未读**（3 条既有 + 20 条新测试），类型覆盖完成/失败/等待输入/等待审批
  - 结论：20 条全部到达并写入提醒记录

| 指标 | 结果 |
| --- | --- |
| 实际触发 | 20 |
| 到达 | **20** |
| 到达率 | **100%**（目标 ≥18/20） |
| 发送失败 | 0 |
| 平均发送耗时 | 424 ms |
| 重复通知 | 未观察到（角标 23 = 3 既有 + 20 新增） |
| 隐私模式 | ✅ 锁屏只显示“DSH Watch / 打开 DSH Watch 查看详情”，无任务标题/内容 |

## 5 失败记录

无（0 failed / 0 removed）。

## 6 点击详情

- ✅ **通过**：点击已有的真实任务通知（23:49“任务已完成”）后，DSH Watch 打开对应任务详情；
- 页面顶部显示“由提醒进入 · 触发原因：任务完成”，任务标题、状态、当前步骤、摘要、时间均正常；
- 证据：`docs/evidence/m2/v06-detail-from-notification.jpg`、`docs/evidence/m2/v06-notification-center-24.jpg`。
- 说明：20 条测试推送的 task ref 为 `v06-20-...`，不是真实任务（点击会打开空详情），因此点击测试使用真实任务通知；结果通过。

## 7 清理与回滚

- 隧道仍在运行（验收期间保持）；验收结束后可 `Ctrl+C` 停止 cloudflared。
- 设备保留使用；如需撤销：App 设置 → 解除配对。

## 8 签收

| 项 | 结论 |
| --- | --- |
| V06 到达率（20 次） | ✅ **通过（20/20，100%）** |
| 锁屏内容/隐私 | ✅ 通过 |
| 点击详情 | ✅ 通过（真实任务通知 → 任务详情） |
| iPhone 型号/iOS 版本 | ✅ iPhone 17 Pro Max / iOS 27.0.1 |
