import SwiftUI

@main
struct DSHWatchApp: App {
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(Theme.green)
                .preferredColorScheme(.light)
        }
    }
}
