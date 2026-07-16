// 下部ナビ 4 タブ: HOME / GitHub / Calendar / Setting。
// 参照: docs/specs/ios-app-screens.md「ナビゲーション構成の決定」
import SwiftUI

struct RootTabView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        @Bindable var state = state
        TabView(selection: $state.selectedTab) {
            HomeView()
                .tabItem { Label("HOME", systemImage: "sun.horizon.fill") }
                .tag(AppTab.home)
            GitHubTabView()
                .tabItem { Label("GitHub", systemImage: "chevron.left.forwardslash.chevron.right") }
                .tag(AppTab.github)
            CalendarTabView()
                .tabItem { Label("Calendar", systemImage: "calendar") }
                .tag(AppTab.calendar)
            SettingsView()
                .tabItem { Label("Setting", systemImage: "gearshape.fill") }
                .tag(AppTab.settings)
        }
    }
}
