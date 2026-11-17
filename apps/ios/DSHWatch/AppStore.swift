import Foundation
import Combine

@MainActor
final class AppStore: ObservableObject {
    @Published var tasks: [TaskSnapshot] = []
    @Published var reminders: [Reminder] = []
    @Published var baseURL: URL?
    @Published var deviceName: String = "我的 iPhone"
    @Published var isRefreshing = false
    @Published var lastSync: Date?
    @Published var errorMessage: String?
    @Published var selection: String?

    private var token: String?
    private var previousStates: [String: String] = [:]
    private let defaults = UserDefaults.standard

    private var dataDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("DSHWatch", isDirectory: true)
    }

    private var tasksFile: URL { dataDirectory.appendingPathComponent("tasks.json") }
    private var remindersFile: URL { dataDirectory.appendingPathComponent("reminders.json") }

    var isPaired: Bool { baseURL != nil && token != nil }

    init() {
        if let urlString = defaults.string(forKey: "baseURL"), let url = URL(string: urlString) {
            baseURL = url
        }
        deviceName = defaults.string(forKey: "deviceName") ?? "我的 iPhone"
        token = KeychainStore.read(key: "deviceToken")
        loadCache()
    }

    func completePairing(baseURL: URL, token: String, deviceName: String) {
        self.baseURL = baseURL
        self.token = token
        self.deviceName = deviceName
        defaults.set(baseURL.absoluteString, forKey: "baseURL")
        defaults.set(deviceName, forKey: "deviceName")
        KeychainStore.save(token, key: "deviceToken")
        loadCache()
        Task { await refresh() }
    }

    private func client() -> APIClient? {
        guard let baseURL, let token else { return nil }
        return APIClient(baseURL: baseURL, token: token)
    }

    func refresh() async {
        guard let client = client() else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let fresh = try await client.tasks()
            updateReminders(with: fresh)
            tasks = fresh.sorted { $0.updatedAt > $1.updatedAt }
            lastSync = Date()
            errorMessage = nil
            saveCache()
        } catch {
            errorMessage = error.localizedDescription
            // 离线时保留缓存，不清空 tasks
        }
    }

    func fetchDetail(taskId: String) async throws -> (TaskSnapshot, [TaskEvent], [ActionRecord], [QuestionRecord]) {
        guard let client = client() else {
            throw APIError(status: 0, code: "not_paired", message: "尚未配对")
        }
        async let snapshot = client.task(id: taskId)
        async let events = client.events(taskId: taskId)
        // 审批/问答桥未启用（旧插件或 404）时，详情仍应正常展示
        let actions = (try? await client.actions(taskId: taskId)) ?? []
        let questions = (try? await client.questions(taskId: taskId)) ?? []
        return try await (snapshot, events, actions, questions)
    }

    func decide(actionId: String, decision: String) async throws -> ActionDecisionResponse {
        guard let client = client() else {
            throw APIError(status: 0, code: "not_paired", message: "尚未配对")
        }
        return try await client.decide(actionId: actionId, decision: decision)
    }

    func answer(actionId: String, answers: [[String: Any]]) async throws -> QuestionAnswerResponse {
        guard let client = client() else {
            throw APIError(status: 0, code: "not_paired", message: "尚未配对")
        }
        return try await client.answer(actionId: actionId, answers: answers)
    }

    func markReminderRead(_ reminder: Reminder) {
        guard let index = reminders.firstIndex(where: { $0.recordId == reminder.recordId }) else { return }
        reminders[index].readAt = Int64(Date().timeIntervalSince1970 * 1000)
        saveCache()
    }

    func markAllRemindersRead() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        reminders = reminders.map { item in
            var copy = item
            if copy.readAt == nil { copy.readAt = now }
            return copy
        }
        saveCache()
    }

    func unpair() {
        token = nil
        baseURL = nil
        tasks = []
        reminders = []
        previousStates = [:]
        defaults.removeObject(forKey: "baseURL")
        KeychainStore.delete(key: "deviceToken")
        try? FileManager.default.removeItem(at: tasksFile)
        try? FileManager.default.removeItem(at: remindersFile)
    }

    func clearCache() {
        tasks = []
        reminders = []
        try? FileManager.default.removeItem(at: tasksFile)
        try? FileManager.default.removeItem(at: remindersFile)
    }

    private func updateReminders(with fresh: [TaskSnapshot]) {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var newReminders = reminders
        for task in fresh {
            guard let old = previousStates[task.taskId], old != task.state else { continue }
            let kind: String?
            if task.isWaiting { kind = task.state }
            else if task.isTerminal { kind = task.state }
            else { kind = nil }
            guard let kind else { continue }
            let recordId = "\(task.taskId):\(task.runId ?? ""):\(kind)"
            guard !newReminders.contains(where: { $0.recordId == recordId }) else { continue }
            newReminders.append(Reminder(
                recordId: recordId,
                taskId: task.taskId,
                kind: kind,
                title: task.title ?? "任务提醒",
                summary: task.isWaiting ? "需要在电脑处理" : task.stateTitle,
                createdAt: now,
                readAt: nil
            ))
        }
        previousStates = Dictionary(uniqueKeysWithValues: fresh.map { ($0.taskId, $0.state) })
        let cutoff = now - 30 * 24 * 3600 * 1000
        reminders = newReminders.filter { $0.createdAt >= cutoff }.sorted { $0.createdAt > $1.createdAt }
    }

    private func loadCache() {
        try? FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: tasksFile),
           let cached = try? JSONDecoder().decode([TaskSnapshot].self, from: data) {
            tasks = cached
            previousStates = Dictionary(uniqueKeysWithValues: cached.map { ($0.taskId, $0.state) })
        }
        if let data = try? Data(contentsOf: remindersFile),
           let cached = try? JSONDecoder().decode([Reminder].self, from: data) {
            reminders = cached
        }
    }

    private func saveCache() {
        try? FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(tasks) { try? data.write(to: tasksFile) }
        if let data = try? JSONEncoder().encode(reminders) { try? data.write(to: remindersFile) }
    }
}
