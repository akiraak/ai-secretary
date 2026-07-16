// GitHub タブ = 昨日の活動（リポジトリ別 commits/PR）+ 各 TODO.md の次の作業。
// 放置検知は後フェーズ。参照: docs/specs/ios-app-screens.md
import SwiftUI

struct GitHubTabView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        NavigationStack {
            List {
                activitySection
                todoSection
            }
            .navigationTitle("GitHub")
            .refreshable { await state.refreshBriefing() }
        }
    }

    private var payload: BriefingPayload? { state.briefing?.payload }

    @ViewBuilder
    private var activitySection: some View {
        let items = payload?.github ?? []
        Section("昨日の活動") {
            if items.isEmpty {
                EmptyRow(message: "昨日の commits / PR はありません")
            } else {
                let byRepo = Dictionary(grouping: items, by: \.repo)
                ForEach(byRepo.keys.sorted(), id: \.self) { repo in
                    VStack(alignment: .leading, spacing: 6) {
                        RepoTag(repo: repo)
                        ForEach((byRepo[repo] ?? []).indices, id: \.self) { i in
                            let item = (byRepo[repo] ?? [])[i]
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: item.kind == "pr" ? "arrow.triangle.pull" : "smallcircle.filled.circle")
                                    .font(.caption)
                                    .foregroundStyle(item.kind == "pr" ? Color.amberAccent : Color.secondary)
                                if let urlString = item.url, let url = URL(string: urlString) {
                                    Link(item.title, destination: url)
                                        .font(.subheadline)
                                        .foregroundStyle(.primary)
                                } else {
                                    Text(item.title).font(.subheadline)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    @ViewBuilder
    private var todoSection: some View {
        let todos = payload?.todos ?? []
        Section("次の作業（各リポジトリの TODO.md）") {
            if todos.isEmpty {
                EmptyRow(message: "TODO は登録されていません")
            } else {
                let byRepo = Dictionary(grouping: todos, by: \.repo)
                ForEach(byRepo.keys.sorted(), id: \.self) { repo in
                    VStack(alignment: .leading, spacing: 6) {
                        RepoTag(repo: repo)
                        ForEach((byRepo[repo] ?? []).indices, id: \.self) { i in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: "circle")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text((byRepo[repo] ?? [])[i].text)
                                    .font(.subheadline)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }
}
