import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        if store.isPaired {
            MainTabView()
        } else {
            PairingView()
        }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            TaskListView()
                .tabItem { Label("任务", systemImage: "square.stack.3d.up") }
            RemindersView()
                .tabItem { Label("提醒", systemImage: "bell") }
            SettingsView()
                .tabItem { Label("设置", systemImage: "gearshape") }
        }
    }
}
