import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showUnpair = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("设置").font(.system(size: 30, weight: .bold)).foregroundStyle(Theme.ink)
                    Text("M3 展示版 · 仅局域网 · 不含推送")
                        .font(.footnote).foregroundStyle(Theme.muted)

                    Card {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("设备").font(.caption).foregroundStyle(Theme.muted)
                            infoRow("当前电脑", store.baseURL?.absoluteString ?? "未配对")
                            infoRow("设备名称", store.deviceName)
                            infoRow("最后同步", store.lastSync.map { absoluteTime(Int64($0.timeIntervalSince1970 * 1000)) } ?? "暂无")
                            Button("清除本机缓存") { store.clearCache() }
                                .font(.footnote.weight(.semibold))
                        }
                    }

                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("关于").font(.caption).foregroundStyle(Theme.muted)
                            Text("DSH Watch · M3 展示版 · 0.1.0")
                                .font(.footnote).foregroundStyle(Theme.ink)
                            Text("锁屏提醒请使用 PWA 版（M2）；原生版用于局域网演示，不含推送与手机审批。")
                                .font(.caption).foregroundStyle(Theme.muted)
                        }
                    }

                    Button(role: .destructive) {
                        showUnpair = true
                    } label: {
                        Text("解除配对").frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.bordered)
                    .confirmationDialog("解除配对会清除本机凭证与缓存，确定？", isPresented: $showUnpair) {
                        Button("解除配对", role: .destructive) { store.unpair() }
                        Button("取消", role: .cancel) {}
                    }
                }
                .padding(18)
            }
            .background(Theme.paper)
            .navigationTitle("设置")
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.footnote).foregroundStyle(Theme.muted).frame(width: 80, alignment: .leading)
            Text(value).font(.footnote).foregroundStyle(Theme.ink).textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }
}
