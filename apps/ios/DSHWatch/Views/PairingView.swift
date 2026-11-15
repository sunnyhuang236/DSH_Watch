import SwiftUI

struct PairingView: View {
    @EnvironmentObject private var store: AppStore
    @State private var baseURLText = ""
    @State private var code = ""
    @State private var deviceName = "我的 iPhone"
    @State private var errorText = ""
    @State private var statusText = ""
    @State private var pairing: PairingRequestResponse?
    @State private var isPairing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("连接你的电脑").font(.system(size: 34, weight: .bold)).foregroundStyle(Theme.ink)
                    Text("M3 展示版 · 仅局域网。输入电脑的网关地址和 8 位配对码。")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                }
                .padding(.top, 28)

                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("电脑网关地址").font(.caption).foregroundStyle(Theme.muted)
                        TextField("http://192.168.1.100:8787", text: $baseURLText)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .autocorrectionDisabled()
                            .padding(12)
                            .background(Theme.paper)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        Text("8 位配对码").font(.caption).foregroundStyle(Theme.muted)
                        TextField("00000000", text: $code)
                            .keyboardType(.numberPad)
                            .padding(12)
                            .background(Theme.paper)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        Text("设备名称").font(.caption).foregroundStyle(Theme.muted)
                        TextField("我的 iPhone", text: $deviceName)
                            .padding(12)
                            .background(Theme.paper)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        if !errorText.isEmpty {
                            Text(errorText).font(.footnote).foregroundStyle(Theme.red)
                        }
                        Button {
                            startPairing()
                        } label: {
                            Text(isPairing ? "等待电脑确认…" : "连接电脑")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.green)
                        .disabled(isPairing)
                    }
                }

                if !statusText.isEmpty {
                    Text(statusText).font(.footnote).foregroundStyle(Theme.muted)
                }
                Text("配对只在电脑与手机之间进行；M3 展示版不含推送，锁屏提醒请使用 PWA（M2）。")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(20)
        }
        .background(Theme.paper)
        .onAppear {
            if baseURLText.isEmpty { baseURLText = store.baseURL?.absoluteString ?? "" }
            deviceName = store.deviceName
        }
    }

    private func startPairing() {
        errorText = ""
        statusText = ""
        guard let url = URL(string: normalizedURL(baseURLText)) else {
            errorText = "电脑地址格式不正确，例如 http://192.168.1.100:8787"
            return
        }
        let codeValue = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard codeValue.count == 8, codeValue.allSatisfy({ $0.isNumber }) else {
            errorText = "请输入 8 位数字配对码"
            return
        }
        isPairing = true
        Task {
            do {
                let client = APIClient(baseURL: url)
                let request = try await client.requestPairing(code: codeValue, deviceName: deviceName)
                pairing = request
                statusText = "等待电脑确认…"
                for _ in 0..<300 {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    let result = try await client.pollPairing(requestId: request.requestId, pollToken: request.pollToken)
                    if result.status == "confirmed", let token = result.deviceToken {
                        statusText = "配对成功"
                        isPairing = false
                        store.completePairing(baseURL: url, token: token, deviceName: result.deviceName ?? deviceName)
                        return
                    }
                    if result.status == "rejected" { throw APIError(status: 0, code: "rejected", message: "电脑拒绝了这次配对") }
                    if result.status == "expired" { throw APIError(status: 0, code: "expired", message: "配对码已过期，请重新生成") }
                }
                throw APIError(status: 0, code: "timeout", message: "等待超时，请重试")
            } catch {
                errorText = error.localizedDescription
            }
            isPairing = false
        }
    }

    private func normalizedURL(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") { return trimmed }
        return "http://" + trimmed
    }
}
