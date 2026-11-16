import Foundation

struct APIError: LocalizedError {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}

private struct APIErrorEnvelope: Decodable {
    struct Inner: Decodable { let code: String?; let message: String? }
    let error: Inner?
}

final class APIClient {
    let baseURL: URL
    var token: String?

    init(baseURL: URL, token: String? = nil) {
        self.baseURL = baseURL
        self.token = token
    }

    private func makeURL(_ path: String) -> URL? {
        URL(string: path, relativeTo: baseURL)
    }

    func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let url = makeURL(path) else {
            throw APIError(status: 0, code: "bad_url", message: "服务器地址无效")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "no_response", message: "没有收到服务器响应")
        }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
            throw APIError(
                status: http.statusCode,
                code: envelope?.error?.code ?? "http_\(http.statusCode)",
                message: envelope?.error?.message ?? "请求失败（\(http.statusCode)）"
            )
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func health() async throws -> HealthResponse {
        try await request("/v1/health")
    }

    func tasks() async throws -> [TaskSnapshot] {
        let response: TasksResponse = try await request("/v1/tasks?limit=200")
        return response.tasks
    }

    func task(id: String) async throws -> TaskSnapshot {
        try await request("/v1/tasks/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }

    func events(taskId: String) async throws -> [TaskEvent] {
        let response: EventsResponse = try await request(
            "/v1/tasks/\(taskId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? taskId)/events?after_seq=-1&limit=200"
        )
        return response.events
    }

    func actions(taskId: String) async throws -> [ActionRecord] {
        let response: ActionsResponse = try await request(
            "/v1/actions?task_id=\(taskId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? taskId)"
        )
        return response.actions
    }

    func decide(actionId: String, decision: String) async throws -> ActionDecisionResponse {
        try await request(
            "/v1/actions/\(actionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? actionId)/decision",
            method: "POST",
            body: ["decision": decision]
        )
    }

    func questions(taskId: String) async throws -> [QuestionRecord] {
        let response: QuestionsResponse = try await request(
            "/v1/questions?task_id=\(taskId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? taskId)"
        )
        return response.questions
    }

    func answer(actionId: String, answers: [[String: Any]]) async throws -> QuestionAnswerResponse {
        try await request(
            "/v1/questions/\(actionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? actionId)/answer",
            method: "POST",
            body: ["answers": answers]
        )
    }

    func requestPairing(code: String, deviceName: String) async throws -> PairingRequestResponse {
        try await request(
            "/v1/pair/requests",
            method: "POST",
            body: ["code": code, "device_name": deviceName]
        )
    }

    func pollPairing(requestId: String, pollToken: String) async throws -> PairingStatusResponse {
        try await request(
            "/v1/pair/requests/\(requestId)?token=\(pollToken)"
        )
    }
}
