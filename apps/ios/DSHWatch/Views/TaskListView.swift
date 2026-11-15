import SwiftUI

struct TaskListView: View {
    @EnvironmentObject private var store: AppStore

    private var waiting: [TaskSnapshot] { store.tasks.filter { $0.isWaiting } }
    private var running: [TaskSnapshot] { store.tasks.filter { $0.isRunning } }
    private var ended: [TaskSnapshot] { store.tasks.filter { $0.isTerminal } }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if let error = store.errorMessage {
                        connectionBanner(error)
                    }
                    header
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        stat("\(waiting.count)", "待处理")
                        stat("\(running.count)", "运行中")
                        stat("\(ended.count)", "最近结束")
                    }
                    .padding(.bottom, 4)
                    if store.tasks.isEmpty {
                        EmptyStateView(symbol: "◫", title: "还没有任务", message: "在电脑上运行 DSH 任务后，这里会出现任务状态。")
                    } else {
                        group("需要你处理", tasks: waiting)
                        group("运行中", tasks: running)
                        group("最近结束", tasks: ended)
                    }
                }
                .padding(18)
            }
            .background(Theme.paper)
            .navigationTitle("任务")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await store.refresh() }
            .task { await store.refresh() }
            .navigationDestination(for: String.self) { taskId in
                TaskDetailView(taskId: taskId)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("DSH WATCH").font(.system(size: 13, weight: .bold)).tracking(1.2).foregroundStyle(Theme.muted)
            if let lastSync = store.lastSync {
                Text("更新于 \(lastSync.formatted(date: .omitted, time: .shortened))")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
        }
        .padding(.bottom, 4)
    }

    private func connectionBanner(_ message: String) -> some View {
        Label("电脑连接中断 · 正在显示缓存（\(message)）", systemImage: "wifi.exclamationmark")
            .font(.footnote)
            .foregroundStyle(Theme.amber)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.tintAmber)
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.system(size: 24, weight: .bold)).foregroundStyle(Theme.ink).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }

    @ViewBuilder
    private func group(_ title: String, tasks: [TaskSnapshot]) -> some View {
        if !tasks.isEmpty {
            HStack {
                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                Spacer()
                Text("\(tasks.count)").font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(.top, 10)
            ForEach(tasks, id: \.taskId) { task in
                NavigationLink(value: task.taskId) {
                    TaskRowView(task: task)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
