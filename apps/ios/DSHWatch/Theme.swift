import SwiftUI

enum Theme {
    static let ink = Color(hex: 0x182C30)
    static let muted = Color(hex: 0x607476)
    static let paper = Color(hex: 0xF3F5F1)
    static let panel = Color.white
    static let line = Color(hex: 0xDBE4E2)
    static let green = Color(hex: 0x16735C)
    static let amber = Color(hex: 0x955B12)
    static let red = Color(hex: 0xB54141)
    static let neutral = Color(hex: 0x6B7C7A)
    static let tintGreen = Color(hex: 0xE3EFEA)
    static let tintAmber = Color(hex: 0xFFF5E2)
    static let tintRed = Color(hex: 0xFFF0EC)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: 1.0
        )
    }
}

extension TaskSnapshot {
    var stateTitle: String {
        switch state {
        case "running": return "运行中"
        case "waiting_input": return "等待你输入"
        case "waiting_approval": return "等待审批"
        case "succeeded": return "已完成"
        case "failed": return "执行失败"
        case "cancelled": return "已取消"
        default: return "状态未知"
        }
    }

    var stateSymbol: String {
        switch state {
        case "running": return "●"
        case "waiting_input", "waiting_approval": return "◷"
        case "succeeded": return "✓"
        case "failed": return "×"
        case "cancelled": return "—"
        default: return "?"
        }
    }

    var stateColor: Color {
        switch state {
        case "running": return Theme.green
        case "waiting_input", "waiting_approval": return Theme.amber
        case "failed": return Theme.red
        case "succeeded", "cancelled", "unknown": return Theme.neutral
        default: return Theme.neutral
        }
    }

    var isWaiting: Bool { state == "waiting_input" || state == "waiting_approval" }
    var isTerminal: Bool { state == "succeeded" || state == "failed" || state == "cancelled" }
    var isRunning: Bool { state == "running" || state == "unknown" }
}
