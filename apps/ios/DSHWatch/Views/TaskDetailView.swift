import SwiftUI

struct TaskDetailView: View {
    let taskId: String
    @EnvironmentObject private var store: AppStore
    @State private var task: TaskSnapshot?
    @State private var events: [TaskEvent] = []
    @State private var actions: [ActionRecord] = []
    @State private var questions: [QuestionRecord] = []
    @State private var selectedOptions: [String: Set<String>] = [:]
    @State private var customAnswers: [String: String] = [:]
    @State private var expandedGroups: [String: Bool] = [:]
    @State private var errorText: String?
    @State private var actionMessage: String?
    @State private var submittingAction: String?
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
                    if let actionMessage {
                        Text(actionMessage)
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.paper)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    approvalCards
                    questionCards
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("当前步骤").font(.caption).foregroundStyle(Theme.muted)
                            Text(task.currentStep.map { "步骤 \($0)" } ?? "暂无步骤信息")
                                .font(.body).foregroundStyle(Theme.ink)
                            if let tool = task.currentTool {
                                Text("工具 · \(tool)").font(.footnote).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(task.isTerminal ? (task.state == "failed" ? "失败摘要" : "结果摘要") : "摘要")
                                .font(.caption).foregroundStyle(Theme.muted)
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
                            infoRow("子代理", task.agentCount > 0
                                    ? "\(task.agentCount) 个\(task.delegationDepth > 0 ? " · 深度 \(task.delegationDepth)" : "")"
                                    : "无")
                            infoRow("父任务", task.parentTaskId ?? "无")
                            infoRow("来源", task.origin ?? "暂无")
                            infoRow("代理状态", task.agentState.isEmpty ? "未知" : task.agentState)
                            infoRow("费用", task.cost == nil ? "暂无数据" : String(task.cost!))
                            infoRow("用量", task.tokenUsage.map { "\($0.inputTokens + $0.outputTokens) tokens" } ?? "暂无数据")
                        }
                    }
                    trajectorySection
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

    // MARK: - 审批 / 问答

    private var approvalCards: some View {
        Group {
            ForEach(actions) { action in
                if action.isPending {
                    Card {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("需要你的决定").font(.headline).foregroundStyle(Theme.ink)
                                Spacer()
                                Text("等待审批")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Theme.amber)
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Theme.tintAmber)
                                    .clipShape(Capsule())
                            }
                            Text(action.localizedReason)
                                .font(.footnote).foregroundStyle(Theme.ink)
                            HStack(spacing: 10) {
                                Button("拒绝") { submitDecision(action, "rejected") }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.red)
                                Button("允许一次") { submitDecision(action, "allowed-once") }
                                    .buttonStyle(.borderedProminent)
                                    .tint(Theme.green)
                            }
                            .disabled(submittingAction != nil)
                        }
                    }
                } else {
                    Card {
                        HStack {
                            Text("审批已处理").font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                            Spacer()
                            Text(action.decision == "mobile" ? "已在手机提交" : "已在电脑处理")
                                .font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        }
    }

    private var questionCards: some View {
        Group {
            ForEach(questions) { record in
                if record.isPending {
                    Card {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("需要你回答").font(.headline).foregroundStyle(Theme.ink)
                                Spacer()
                                Text("等待答题")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Theme.amber)
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Theme.tintAmber)
                                    .clipShape(Capsule())
                            }
                            ForEach(record.questions) { question in
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(question.question).font(.body).foregroundStyle(Theme.ink)
                                    if let detail = question.detail {
                                        Text(detail).font(.footnote).foregroundStyle(Theme.muted)
                                    }
                                    if !question.options.isEmpty {
                                        ForEach(question.options) { option in
                                            Button {
                                                toggleOption(question, option)
                                            } label: {
                                                HStack(alignment: .top, spacing: 8) {
                                                    Image(systemName: selectedOptions[question.id, default: []].contains(option.label)
                                                          ? (question.multiSelect ? "checkmark.square.fill" : "largecircle.fill.circle")
                                                          : (question.multiSelect ? "square" : "circle"))
                                                        .foregroundStyle(Theme.green)
                                                    Text(option.label).font(.footnote).foregroundStyle(Theme.ink)
                                                    if let description = option.description {
                                                        Text(description).font(.caption2).foregroundStyle(Theme.muted)
                                                    }
                                                    Spacer(minLength: 0)
                                                }
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                    TextField("补充回答（可选）", text: customBinding(question.id))
                                        .textFieldStyle(.roundedBorder)
                                        .font(.footnote)
                                }
                                .padding(.vertical, 4)
                            }
                            Button("提交回答") { submitAnswers(record) }
                                .buttonStyle(.borderedProminent)
                                .tint(Theme.green)
                                .disabled(submittingAction != nil)
                        }
                    }
                } else {
                    Card {
                        HStack {
                            Text("问答已处理").font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                            Spacer()
                            Text(record.decision == "mobile" ? "已在手机提交" : "已在电脑回答")
                                .font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        }
    }

    private func submitDecision(_ action: ActionRecord, _ decision: String) {
        submittingAction = action.actionId
        actionMessage = nil
        Task {
            do {
                let result = try await store.decide(actionId: action.actionId, decision: decision)
                actionMessage = result.status == "accepted" ? "已提交，等待电脑确认" : "该审批已被处理"
                await load()
            } catch {
                actionMessage = "审批提交失败：\(error.localizedDescription)"
            }
            submittingAction = nil
        }
    }

    private func submitAnswers(_ record: QuestionRecord) {
        submittingAction = record.actionId
        actionMessage = nil
        let answers: [[String: Any]] = record.questions.map { question in
            var item: [String: Any] = [
                "id": question.id,
                "selected": Array(selectedOptions[question.id, default: []]),
            ]
            let custom = (customAnswers[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !custom.isEmpty { item["custom"] = custom }
            return item
        }
        Task {
            do {
                let result = try await store.answer(actionId: record.actionId, answers: answers)
                actionMessage = result.status == "accepted" ? "回答已提交，等待电脑确认" : "该问题已处理"
                await load()
            } catch {
                actionMessage = "回答提交失败：\(error.localizedDescription)"
            }
            submittingAction = nil
        }
    }

    private func toggleOption(_ question: QuestionItem, _ option: QuestionOption) {
        var selected = selectedOptions[question.id, default: []]
        if question.multiSelect {
            if selected.contains(option.label) { selected.remove(option.label) } else { selected.insert(option.label) }
        } else {
            selected = [option.label]
        }
        selectedOptions[question.id] = selected
    }

    private func customBinding(_ questionId: String) -> Binding<String> {
        Binding(
            get: { customAnswers[questionId] ?? "" },
            set: { customAnswers[questionId] = $0 }
        )
    }

    // MARK: - 轨迹

    private struct EventGroup: Identifiable {
        let id: String
        let label: String
        let events: [TaskEvent]
        let abnormal: Bool
    }

    private var groups: [EventGroup] {
        var map: [String: [TaskEvent]] = [:]
        for event in events {
            let key: String
            if let runId = event.runId {
                key = runId
            } else if let turn = event.payload?.turnValue {
                key = "turn:\(turn)"
            } else {
                key = "other"
            }
            map[key, default: []].append(event)
        }
        return map.map { key, groupEvents in
            let sorted = groupEvents.sorted { $0.seq < $1.seq }
            let abnormal = sorted.contains { event in
                let p = event.payload
                return p?.boolValue("is_error") == true
                    || event.type == "diagnostic"
                    || event.type == "approval_decided"
                    || ["error", "blocked", "max-tokens"].contains(p?.stringValue("reason_kind") ?? "")
                    || ["rejected", "cancelled"].contains(p?.stringValue("outcome") ?? "")
            }
            let label: String
            if let turn = sorted.last?.payload?.turnValue {
                label = "轮次 \(turn)"
            } else if key == "other" {
                label = "其他事件"
            } else {
                label = "轮次"
            }
            return EventGroup(id: key, label: label, events: sorted, abnormal: abnormal)
        }
        .sorted { ($0.events.last?.seq ?? 0) < ($1.events.last?.seq ?? 0) }
    }

    private var trajectorySection: some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                Text("轨迹（按轮次折叠）").font(.caption).foregroundStyle(Theme.muted)
                if groups.isEmpty {
                    Text("暂无事件").font(.footnote).foregroundStyle(Theme.muted)
                } else {
                    ForEach(groups) { group in
                        DisclosureGroup(isExpanded: expandedBinding(group)) {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(group.events.reversed()) { event in
                                    eventRow(event)
                                    Divider().overlay(Theme.line)
                                }
                            }
                        } label: {
                            HStack {
                                Text(group.label).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text("\(group.events.count) 条事件\(group.abnormal ? " · 含异常" : "")")
                                    .font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            }
        }
    }

    private func expandedBinding(_ group: EventGroup) -> Binding<Bool> {
        Binding(
            get: {
                if let value = expandedGroups[group.id] { return value }
                return group.abnormal || group.id == groups.last?.id
            },
            set: { expandedGroups[group.id] = $0 }
        )
    }

    // MARK: - 基础展示

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
            VStack(alignment: .leading, spacing: 2) {
                Text(eventTitle(event.type)).font(.footnote.weight(.medium)).foregroundStyle(Theme.ink)
                if let detail = event.payload?.eventDetail {
                    Text(detail).font(.caption2).foregroundStyle(Theme.muted).lineLimit(2)
                }
            }
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
            actions = result.2
            questions = result.3
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }
}

private extension Dictionary where Key == String, Value == JSONValue {
    var turnValue: Int? {
        guard case .number(let value) = self["turn"] else { return nil }
        return Int(value)
    }

    func stringValue(_ key: String) -> String? {
        guard case .string(let value) = self[key] else { return nil }
        return value
    }

    func boolValue(_ key: String) -> Bool? {
        guard case .bool(let value) = self[key] else { return nil }
        return value
    }

    var eventDetail: String? {
        if case .string(let name) = self["name"] { return name }
        if case .string(let toolName) = self["tool_name"] { return toolName }
        if case .string(let reason) = self["reason_kind"] { return reason }
        return nil
    }
}
