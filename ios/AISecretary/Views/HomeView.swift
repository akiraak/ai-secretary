// HOME = 案A 統合フィード。LLM 要約カード + 緊急順セクション
// （締切が近い → 今日やる → 要対応 → 昨日の GitHub → 次の作業）を 1 画面スクロール。
// 参照: docs/specs/ios-app-screens.md「3. 今日のブリーフィング」
import SwiftUI

/// HOME「今日やる」に選抜する TODO の件数（残りは「次の作業」に折りたたむ）
private let todayTodoCount = 5

struct HomeView: View {
    @Environment(AppState.self) private var state
    // 済チェックは v1 では画面内のみ（元 TODO.md / Gmail への書き戻しは後フェーズ）
    @State private var doneTodos: Set<String> = []
    @State private var doneMails: Set<String> = []
    @State private var showNextTodos = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    if let message = state.lastErrorMessage {
                        noticeBanner(message)
                    }
                    if let briefing = state.briefing {
                        summaryCard(briefing)
                        sections(briefing.payload)
                    } else if !state.isConfigured {
                        setupPromptCard
                    }
                    footer
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .background(Color.appBackground)
            .navigationTitle(dateTitle)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await state.refreshBriefing() }
                    } label: {
                        if state.isRefreshing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(state.isRefreshing)
                }
            }
            .refreshable { await state.refreshBriefing() }
        }
        .task {
            if state.briefing == nil && state.isConfigured {
                await state.refreshBriefing()
            }
        }
    }

    // MARK: ヘッダ・要約

    private var dateTitle: String {
        BriefingDate.longDayLabel(state.briefing?.date ?? ISO8601DateFormatter().string(from: .now))
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: .now) {
        case 4..<11: return "おはようございます"
        case 11..<18: return "こんにちは"
        default: return "こんばんは"
        }
    }

    private var header: some View {
        Text(greeting)
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    private func summaryCard(_ briefing: LatestBriefing) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("今日のまとめ", systemImage: "sun.horizon.fill")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Color.amberAccent)
            if let title = briefing.title, !title.isEmpty {
                Text(title).font(.headline)
            }
            Text(briefing.summary ?? "")
                .font(.subheadline)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.amberAccent.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: セクション（緊急順）

    @ViewBuilder
    private func sections(_ payload: BriefingPayload) -> some View {
        let todayTodos = Array(payload.todos.prefix(todayTodoCount))
        let nextTodos = Array(payload.todos.dropFirst(todayTodoCount))
        let actionMails = payload.mails.filter { $0.priority == "action" }
        let infoMails = payload.mails.filter { $0.priority != "action" }

        SectionCard(title: "締切が近い", linkTab: .calendar) {
            if payload.deadlines.isEmpty {
                EmptyRow(message: "直近の締切はありません")
            } else {
                ForEach(payload.deadlines.indices, id: \.self) { i in
                    deadlineRow(payload.deadlines[i])
                }
            }
        }

        SectionCard(title: "今日やる", linkTab: .github) {
            if todayTodos.isEmpty {
                EmptyRow(message: "TODO は登録されていません")
            } else {
                ForEach(todayTodos.indices, id: \.self) { i in
                    todoRow(todayTodos[i])
                }
            }
        }

        SectionCard(title: "要対応") {
            if actionMails.isEmpty {
                EmptyRow(message: "要対応のメールはありません")
            } else {
                ForEach(actionMails.indices, id: \.self) { i in
                    mailRow(actionMails[i])
                }
            }
            if !infoMails.isEmpty {
                Divider()
                ForEach(infoMails.indices, id: \.self) { i in
                    infoMailRow(infoMails[i])
                }
            }
        }

        SectionCard(title: "昨日の GitHub", linkTab: .github) {
            if payload.github.isEmpty {
                EmptyRow(message: "昨日の活動はありません")
            } else {
                githubSummary(payload.github)
            }
        }

        if !nextTodos.isEmpty {
            SectionCard(title: "次の作業") {
                DisclosureGroup(isExpanded: $showNextTodos) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(nextTodos.indices, id: \.self) { i in
                            todoRow(nextTodos[i])
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("残り \(nextTodos.count) 件")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func deadlineRow(_ item: DeadlineItem) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            DuePill(dueAt: item.dueAt)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.subheadline)
                if let course = item.course, !course.isEmpty {
                    Text(course).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
    }

    private func todoRow(_ item: TodoItem) -> some View {
        let key = "\(item.repo)|\(item.text)"
        let done = doneTodos.contains(key)
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Button {
                if done { doneTodos.remove(key) } else { doneTodos.insert(key) }
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(done ? Color.doneGreen : Color.secondary)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.text)
                    .font(.subheadline)
                    .strikethrough(done)
                    .foregroundStyle(done ? .secondary : .primary)
                RepoTag(repo: item.repo)
            }
            Spacer()
        }
    }

    private func mailRow(_ item: MailItem) -> some View {
        let key = "\(item.from)|\(item.subject)"
        let done = doneMails.contains(key)
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Button {
                if done { doneMails.remove(key) } else { doneMails.insert(key) }
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(done ? Color.doneGreen : Color.secondary)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.subject)
                    .font(.subheadline.weight(.medium))
                    .strikethrough(done)
                    .foregroundStyle(done ? .secondary : .primary)
                Text(item.from).font(.caption).foregroundStyle(.secondary)
                Text(item.reason).font(.caption).foregroundStyle(Color.amberAccent)
            }
            Spacer()
            if let link = item.gmailLink, let url = URL(string: link) {
                Link(destination: url) {
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /// 参考メールは 1 行の控えめ表示
    private func infoMailRow(_ item: MailItem) -> some View {
        HStack(spacing: 8) {
            Text("参考")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Color.secondary.opacity(0.15), in: Capsule())
            Text(item.subject)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer()
        }
    }

    /// リポジトリ別にコミット数を集約し、PR はタイトルを出す
    private func githubSummary(_ items: [GithubItem]) -> some View {
        let byRepo = Dictionary(grouping: items, by: \.repo)
        return VStack(alignment: .leading, spacing: 8) {
            ForEach(byRepo.keys.sorted(), id: \.self) { repo in
                let repoItems = byRepo[repo] ?? []
                let commits = repoItems.filter { $0.kind == "commit" }.count
                let prs = repoItems.filter { $0.kind == "pr" }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        RepoTag(repo: repo)
                        if commits > 0 {
                            Text("\(commits) commits")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    ForEach(prs.indices, id: \.self) { i in
                        Label(prs[i].title, systemImage: "arrow.triangle.pull")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: 補助表示

    private func noticeBanner(_ message: String) -> some View {
        Label(message, systemImage: "info.circle")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.cardBackground, in: RoundedRectangle(cornerRadius: 10))
    }

    private var setupPromptCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "gearshape.fill")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("バックエンドに接続すると\n毎朝のブリーフィングが表示されます")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Setting タブで設定する") {
                state.selectedTab = .settings
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(Color.cardBackground, in: RoundedRectangle(cornerRadius: 14))
    }

    private var footer: some View {
        Text("毎朝 07:00（シアトル時間）に自動配信 ・ 引っ張って更新")
            .font(.caption)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
    }
}
