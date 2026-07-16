import SwiftUI

@main
struct AISecretaryApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var state = AppState.shared

    var body: some Scene {
        WindowGroup {
            Group {
                if state.onboardingDone {
                    RootTabView()
                } else {
                    OnboardingView()
                }
            }
            .environment(state)
            .tint(.amberAccent)
        }
    }
}
