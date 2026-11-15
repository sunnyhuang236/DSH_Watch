import SwiftUI

struct RemindersView: View {
    @EnvironmentObject private var store: AppStore

    private var unread: Int { store.reminders.filter { $0.readAt == nil }.count }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    Text("提醒").font(.system(size: 30, weight: .bold)).foregroundStyle(Theme.ink)
                    Text("提醒保存在本机；M3 展示版无推送，提醒记录来自 App 内状态变化。")
                        .font(.footnote).foregroundStyle(Theme.muted)
                        .padding(.bottom, 8)
                    if !store.reminders.isEmpty {
                        HStack {
                            Text("\(unread) 条未读 · 共 \(store.reminders.count) 条")
                                .font(.footnote).foregroundStyle(Theme.muted)
                            Spacer()
                            Button("全部已读") { store.markAllRemindersRead() }
                                .font(.footnote.weight(.semibold))
                        }
                    }
                    if store.reminders.isEmpty {
                        EmptyStateView(symbol: "◔", title: "还没有提醒", message: "任务完成或需要你处理时会出现在这里。")
                    } else {
                        ForEach(store.reminders) { reminder in
                            NavigationLink(value: reminder.taskId) {
                                reminderRow(reminder)
                            }
                            .buttonStyle(.plain)
                            .simultaneousGesture(TapGesture().onEnded { store.markReminderRead(reminder) })
                        }
                    }
                }
                .padding(18)
            }
            .background(Theme.paper)
            .navigationTitle("提醒")
            .navigationDestination(for: String.self) { taskId in
                TaskDetailView(taskId: taskId)
            }
        }
    }

    private func reminderRow(_ reminder: Reminder) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(reminder.title).font(.headline).foregroundStyle(Theme.ink).lineLimit(1)
                    Spacer()
                    Text(kindTitle(reminder.kind))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(kindColor(reminder.kind))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(kindColor(reminder.kind).opacity(0.12))
                        .clipShape(Capsule())
                }
                Text(reminder.summary).font(.footnote).foregroundStyle(Theme.muted)
                HStack(spacing: 6) {
                    if reminder.readAt == nil {
                        Circle().fill(Theme.green).frame(width: 6, height: 6)
                        Text("未读").font(.caption2).foregroundStyle(Theme.muted)
                    }
                    Text(relativeTime(reminder.createdAt)).font(.caption2).foregroundStyle(Theme.muted).monospacedDigit()
                }
            }
        }
    }

    private func kindTitle(_ kind: String) -> String {
        switch kind {
        case "succeeded": return "任务完成"
        case "failed": return "任务失败"
        case "cancelled": return "任务取消"
        case "waiting_input": return "等待你输入"
        case "waiting_approval": return "等待审批"
        default: return "提醒"
        }
    }

    private func kindColor(_ kind: String) -> Color {
        switch kind {
        case "failed": return Theme.red
        case "waiting_input", "waiting_approval": return Theme.amber
        default: return Theme.neutral
        }
    }
}
