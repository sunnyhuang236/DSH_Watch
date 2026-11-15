import SwiftUI

struct TaskDetailView: View {
    let taskId: String
    @EnvironmentObject private var store: AppStore
    @State private var task: TaskSnapshot?
    @State private var events: [TaskEvent] = []
    @State private var errorText: String?
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if isLoading && task == nil {
                    ProgressView("加载中…").frame(maxWidth: .infinity).padding(.vertical, 40)
                } else if let task {
                    detailHeader(task)
                    if task.isWaiting, let waiting = task.waiting {
                        waitingBanner(task, waiting)
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("当前步骤").font(.caption).foregroundStyle(Theme.muted)
                            Text(task.currentStep.map { "步骤 \($0)" } ?? "暂无步骤信息")
                                .font(.body).foregroundStyle(Theme.ink)
                        }
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(task.isTerminal ? "结果摘要" : "摘要").font(.caption).foregroundStyle(Theme.muted)
                            Text(task.summary ?? "暂无数据").font(.body).foregroundStyle(Theme.ink)
                        }
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("时间与来源").font(.caption).foregroundStyle(Theme.muted)
                            infoRow("开始", absoluteTime(task.startedAt))
                            infoRow("最近活动", absoluteTime(task.lastActivityAt))
                            infoRow("结束", absoluteTime(task.endedAt))
                            infoRow("执行", task.runId ?? "暂无")
                            infoRow("子代理", task.delegationDepth > 0 ? "深度 \(task.delegationDepth)" : "无")
                            infoRow("用量", task.tokenUsage.map { "\($0.inputTokens + $0.outputTokens) tokens" } ?? "暂无数据")
                        }
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("事件（最近 \(events.count) 条）").font(.caption).foregroundStyle(Theme.muted)
                            if events.isEmpty { Text("暂无事件").font(.footnote).foregroundStyle(Theme.muted) }
                            ForEach(events.reversed()) { event in
                                eventRow(event)
                                Divider().overlay(Theme.line)
                            }
                        }
                    }
                } else {
                    EmptyStateView(symbol: "⚠", title: "无法加载任务", message: errorText ?? "连接电脑后重试")
                }
            }
            .padding(18)
        }
        .background(Theme.paper)
        .navigationTitle("任务详情")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func detailHeader(_ task: TaskSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(task.title ?? task.taskId).font(.system(size: 26, weight: .bold)).foregroundStyle(Theme.ink)
                Spacer(minLength: 4)
                StateChip(task: task)
            }
            Text("数据更新于 \(absoluteTime(task.updatedAt))")
                .font(.caption).foregroundStyle(Theme.muted).monospacedDigit()
        }
    }

    private func waitingBanner(_ task: TaskSnapshot, _ waiting: WaitingInfo) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("需要在电脑处理").font(.subheadline.weight(.semibold))
            Text(waiting.kind == "approval"
                 ? "等待你在电脑上批准\(waiting.toolName.map { "「\($0)」" } ?? "")。"
                 : "等待你确认\(waiting.toolName.map { "（\($0)）" } ?? "")。")
                .font(.footnote)
        }
        .foregroundStyle(Theme.amber)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.tintAmber)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.footnote).foregroundStyle(Theme.muted).frame(width: 76, alignment: .leading)
            Text(value).font(.footnote).foregroundStyle(Theme.ink).monospacedDigit()
            Spacer(minLength: 0)
        }
    }

    private func eventRow(_ event: TaskEvent) -> some View {
        HStack {
            Text(eventTitle(event.type)).font(.footnote.weight(.medium)).foregroundStyle(Theme.ink)
            Spacer()
            Text("#\(event.seq) · \(absoluteTime(event.occurredAt))")
                .font(.caption2).foregroundStyle(Theme.muted).monospacedDigit()
        }
        .padding(.vertical, 5)
    }

    private func eventTitle(_ type: String) -> String {
        switch type {
        case "run_started": return "轮次开始"
        case "run_finished": return "轮次结束"
        case "step_started": return "步骤开始"
        case "step_finished": return "步骤结束"
        case "tool_started": return "工具调用"
        case "tool_finished": return "工具结果"
        case "assistant": return "模型输出"
        case "user_message": return "用户消息"
        case "approval_requested": return "审批请求"
        case "approval_decided": return "审批结果"
        default: return type
        }
    }

    private func load() async {
        do {
            let result = try await store.fetchDetail(taskId: taskId)
            task = result.0
            events = result.1
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }
}
