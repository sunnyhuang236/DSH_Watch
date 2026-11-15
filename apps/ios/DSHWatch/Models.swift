import Foundation

struct TaskCapabilities: Codable, Equatable {
    let approval: Bool
    let cost: Bool
    let agents: Bool
}

struct TokenUsage: Codable, Equatable {
    let inputTokens: Int
    let outputTokens: Int
    let cacheReadTokens: Int
    let cacheWriteTokens: Int
    let totalTokens: Int
    let messages: Int

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case cacheReadTokens = "cache_read_tokens"
        case cacheWriteTokens = "cache_write_tokens"
        case totalTokens = "total_tokens"
        case messages
    }
}

struct WaitingInfo: Codable, Equatable {
    let kind: String
    let since: Int64
    let callId: String?
    let approvalId: String?
    let toolName: String?

    enum CodingKeys: String, CodingKey {
        case kind, since
        case callId = "call_id"
        case approvalId = "approval_id"
        case toolName = "tool_name"
    }
}

struct TaskSnapshot: Codable, Identifiable, Equatable {
    let schemaVersion: String
    let taskId: String
    let runId: String?
    let state: String
    let stateVersion: Int
    let title: String?
    let summary: String?
    let startedAt: Int64?
    let updatedAt: Int64
    let lastActivityAt: Int64?
    let endedAt: Int64?
    let capabilities: TaskCapabilities
    let cost: Double?
    let tokenUsage: TokenUsage?
    let agentCount: Int
    let agentState: String
    let connection: String
    let delegationDepth: Int
    let parentTaskId: String?
    let origin: String?
    let currentStep: Int?
    let currentTool: String?
    let waiting: WaitingInfo?

    var id: String { taskId }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case taskId = "task_id"
        case runId = "run_id"
        case state
        case stateVersion = "state_version"
        case title, summary
        case startedAt = "started_at"
        case updatedAt = "updated_at"
        case lastActivityAt = "last_activity_at"
        case endedAt = "ended_at"
        case capabilities, cost
        case tokenUsage = "token_usage"
        case agentCount = "agent_count"
        case agentState = "agent_state"
        case connection
        case delegationDepth = "delegation_depth"
        case parentTaskId = "parent_task_id"
        case origin
        case currentStep = "current_step"
        case currentTool = "current_tool"
        case waiting
    }
}

struct TasksResponse: Codable {
    let schemaVersion: String?
    let tasks: [TaskSnapshot]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case tasks
        case nextCursor = "next_cursor"
    }
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

struct TaskEvent: Codable, Identifiable, Equatable {
    let eventId: String
    let taskId: String
    let runId: String?
    let seq: Int
    let type: String
    let occurredAt: Int64
    let payload: [String: JSONValue]?

    var id: String { eventId }

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case taskId = "task_id"
        case runId = "run_id"
        case seq, type
        case occurredAt = "occurred_at"
        case payload
    }
}

struct EventsResponse: Codable {
    let events: [TaskEvent]
}

struct HealthResponse: Codable {
    let ok: Bool
    let service: String
    let publicUrl: String?
    let devices: Int
    let subscriptions: Int

    enum CodingKeys: String, CodingKey {
        case ok, service
        case publicUrl = "public_url"
        case devices, subscriptions
    }
}

struct PairingRequestResponse: Codable {
    let requestId: String
    let pollToken: String
    let pairingId: String
    let status: String
    let expiresAt: Int64?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case pollToken = "poll_token"
        case pairingId = "pairing_id"
        case status
        case expiresAt = "expires_at"
    }
}

struct PairingStatusResponse: Codable {
    let status: String
    let deviceId: String?
    let deviceToken: String?
    let deviceName: String?

    enum CodingKeys: String, CodingKey {
        case status
        case deviceId = "device_id"
        case deviceToken = "device_token"
        case deviceName = "device_name"
    }
}

struct Reminder: Codable, Identifiable, Equatable {
    let recordId: String
    let taskId: String
    let kind: String
    let title: String
    let summary: String
    let createdAt: Int64
    var readAt: Int64?

    var id: String { recordId }

    enum CodingKeys: String, CodingKey {
        case recordId = "record_id"
        case taskId = "task_id"
        case kind, title, summary
        case createdAt = "created_at"
        case readAt = "read_at"
    }
}
