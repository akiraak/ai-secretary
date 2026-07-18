// リポジトリ詳細 = ヘッダ（リポジトリ名 / 更新時刻 / GitHub リンク）+ 直近の作業 + TODO + 昨日の活動。
// データは payload.repos の 1 要素と payload.todos / payload.github の join
// （朝のブリーフィング時点のスナップショット）。参照: docs/specs/ios-app-screens.md
import SwiftUI

struct RepoDetailView: View {
    @Environment(AppState.self) private var state
    let overview: RepoOverview

    /// TODO / コミット一覧の折りたたみ閾値（超過分はトグルで展開）
    private static let collapseLimit = 5
    @State private var showAllTodos = false
    @State private var showAllCommits = false

    private var payload: BriefingPayload? { state.briefing?.payload }

    /// owner/name の name 部分（画面タイトル用）
    private var name: String {
        overview.repo.split(separator: "/").last.map(String.init) ?? overview.repo
    }

    /// backend が解決した todoRepo で payload.todos を絞った未完了タスク
    private var todos: [TodoItem] {
        guard let todoRepo = overview.todoRepo else { return [] }
        return (payload?.todos ?? []).filter { $0.repo == todoRepo }
    }

    /// 昨日の活動。GithubItem.repo は events API 由来の owner/name なので完全一致で絞る
    private var yesterdayItems: [GithubItem] {
        (payload?.github ?? []).filter { $0.repo == overview.repo }
    }

    var body: some View {
        List {
            headerSection
            if overview.todoSummary != nil || !todos.isEmpty {
                todoSection
            }
            recentSection
            if !yesterdayItems.isEmpty {
                yesterdaySection
            }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: ヘッダ

    private var headerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                RepoTag(repo: overview.repo)
                HStack(spacing: 14) {
                    Label("更新 \(BriefingDate.agoLabel(overview.pushedAt))", systemImage: "clock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let url = URL(string: overview.url) {
                        Link(destination: url) {
                            Label("GitHub で開く", systemImage: "arrow.up.right.square")
                                .font(.caption)
                        }
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: 直近の作業（サマリー + コミット一覧）

    private var recentSection: some View {
        Section("直近の作業") {
            if let summary = overview.recentSummary, !summary.isEmpty {
                Text(summary)
                    .font(.subheadline)
                    .lineSpacing(3)
            }
            if overview.commits.isEmpty {
                EmptyRow(message: "直近のコミットはありません")
            } else {
                let visible = showAllCommits ? overview.commits : Array(overview.commits.prefix(Self.collapseLimit))
                ForEach(visible.indices, id: \.self) { i in
                    commitRow(visible[i])
                }
                if overview.commits.count > Self.collapseLimit {
                    expandButton(isOpen: $showAllCommits, hiddenCount: overview.commits.count - Self.collapseLimit)
                }
            }
        }
    }

    private func commitRow(_ commit: RepoCommit) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let urlString = commit.url, let url = URL(string: urlString) {
                Link(commit.message, destination: url)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
            } else {
                Text(commit.message)
                    .font(.subheadline)
                    .lineLimit(3)
            }
            Text(BriefingDate.shortDateLabel(commit.date))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 1)
    }

    // MARK: TODO（サマリー + 全タスク）

    private var todoSection: some View {
        Section("TODO") {
            if let todoSummary = overview.todoSummary, !todoSummary.isEmpty {
                Text(todoSummary)
                    .font(.subheadline)
                    .lineSpacing(3)
            }
            let visible = showAllTodos ? todos : Array(todos.prefix(Self.collapseLimit))
            ForEach(visible.indices, id: \.self) { i in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(visible[i].text)
                        .font(.subheadline)
                }
            }
            if todos.count > Self.collapseLimit {
                expandButton(isOpen: $showAllTodos, hiddenCount: todos.count - Self.collapseLimit)
            }
        }
    }

    /// 6 件目以降の展開/折りたたみトグル（TODO / コミット一覧で共用）
    private func expandButton(isOpen: Binding<Bool>, hiddenCount: Int) -> some View {
        Button {
            withAnimation { isOpen.wrappedValue.toggle() }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isOpen.wrappedValue ? "chevron.up" : "chevron.down")
                Text(isOpen.wrappedValue ? "折りたたむ" : "残り \(hiddenCount) 件を表示")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Color.coralAccent)
        }
        .buttonStyle(.plain)
    }

    // MARK: 昨日の活動（commits / PR）

    private var yesterdaySection: some View {
        Section("昨日の活動") {
            ForEach(yesterdayItems.indices, id: \.self) { i in
                let item = yesterdayItems[i]
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: item.kind == "pr" ? "arrow.triangle.pull" : "smallcircle.filled.circle")
                        .font(.caption)
                        .foregroundStyle(item.kind == "pr" ? Color.coralAccent : Color.secondary)
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
    }
}
