// GitHub タブ = 更新順リポジトリ一覧（直近作業サマリー + TODO サマリー付き）。
// payload.repos が無い旧ブリーフィングは従来の 2 セクション表示にフォールバック。
// 参照: docs/specs/ios-app-screens.md
import SwiftUI

struct GitHubTabView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        NavigationStack {
            List {
                if let repos = payload?.repos {
                    repoListSection(repos)
                } else {
                    activitySection
                    todoSection
                }
            }
            .navigationTitle("GitHub")
            .refreshable { await state.refreshBriefing() }
        }
    }

    private var payload: BriefingPayload? { state.briefing?.payload }

    // MARK: 更新順リポジトリ一覧

    @ViewBuilder
    private func repoListSection(_ repos: [RepoOverview]) -> some View {
        Section("リポジトリ（更新順）") {
            if repos.isEmpty {
                EmptyRow(message: "直近 90 日に更新されたリポジトリはありません")
            } else {
                // backend で pushed_at 降順に整列済みだが保険で再ソート
                let sorted = repos.sorted {
                    (BriefingDate.parse($0.pushedAt) ?? .distantPast) > (BriefingDate.parse($1.pushedAt) ?? .distantPast)
                }
                ForEach(sorted, id: \.repo) { repo in
                    RepoOverviewRow(overview: repo)
                }
            }
        }
    }

    // MARK: 旧 payload フォールバック（昨日の活動 + TODO 全文）

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

/// 一覧の 1 行: リポジトリ名 + 相対更新時刻 + TODO 件数ピル + 直近作業/TODO サマリー。
/// TODO サマリーが無いリポジトリは件数ピルのみ（サマリー生成失敗時のフォールバック）
private struct RepoOverviewRow: View {
    let overview: RepoOverview

    /// owner/name の name 部分（一覧では短く見せる。owner は詳細画面で）
    private var name: String {
        overview.repo.split(separator: "/").last.map(String.init) ?? overview.repo
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(BriefingDate.agoLabel(overview.pushedAt))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                if overview.todoCount > 0 {
                    TodoCountPill(count: overview.todoCount)
                }
            }
            if let summary = overview.recentSummary, !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .lineSpacing(2)
                    .lineLimit(2)
            }
            if let todoSummary = overview.todoSummary, !todoSummary.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("TODO")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.repoBlue)
                    Text(todoSummary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineSpacing(2)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// TODO.md の未完了件数ピル
private struct TodoCountPill: View {
    let count: Int

    var body: some View {
        Text("TODO \(count)")
            .font(.caption2.weight(.semibold).monospacedDigit())
            .foregroundStyle(Color.repoBlue)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.repoBlue.opacity(0.12), in: Capsule())
    }
}
