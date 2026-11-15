import SwiftUI

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

struct StateChip: View {
    let task: TaskSnapshot
    var body: some View {
        Text("\(task.stateSymbol) \(task.stateTitle)")
            .font(.caption.weight(.semibold))
            .foregroundStyle(task.stateColor)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(task.stateColor.opacity(0.12))
            .clipShape(Capsule())
    }
}

struct TaskRowView: View {
    let task: TaskSnapshot
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(task.title ?? task.taskId)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                Text(task.summary ?? "暂无摘要")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                Text("\(relativeTime(task.updatedAt)) · \(absoluteTime(task.updatedAt))")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .monospacedDigit()
            }
            Spacer(minLength: 4)
            StateChip(task: task)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 8) {
            Text(symbol).font(.system(size: 34)).foregroundStyle(Theme.line)
            Text(title).font(.headline).foregroundStyle(Theme.ink)
            Text(message).font(.footnote).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

func dateFromMillis(_ value: Int64?) -> Date? {
    guard let value else { return nil }
    return Date(timeIntervalSince1970: Double(value) / 1000.0)
}

func relativeTime(_ value: Int64) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter.localizedString(for: dateFromMillis(value) ?? Date(), relativeTo: Date())
}

func absoluteTime(_ value: Int64?) -> String {
    guard let value, let date = dateFromMillis(value) else { return "暂无" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.dateFormat = "MM/dd HH:mm"
    return formatter.string(from: date)
}
