// HOME = 案A 統合フィード。LLM 要約カード + 緊急順セクション
// （要対応 → 締切が近い(Canvas) → カレンダー(直近7日) → GitHub(TODO サマリー)）を 1 画面スクロール。
// 「昨日の GitHub」（commits/PR 集計）は GitHub タブへ集約済み（HOME には出さない）。
// 参照: docs/specs/ios-app-screens.md「3. 今日のブリーフィング」
import SwiftUI

struct HomeView: View {
    /// GitHub セクションのリポジトリ折りたたみ閾値（超過分はトグルで展開）
    private static let githubCollapseLimit = 5
    @Environment(AppState.self) private var state
    // 済チェックは v1 では画面内のみ（Gmail への書き戻しは後フェーズ）
    @State private var doneMails: Set<String> = []
    @State private var showAllGithubRepos = false

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
                .foregroundStyle(Color.coralAccent)
            if let title = briefing.title, !title.isEmpty {
                Text(title).font(.headline)
            }
            Text(briefing.summary ?? "")
                .font(.subheadline)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.coralAccent.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: セクション（緊急順）

    @ViewBuilder
    private func sections(_ payload: BriefingPayload) -> some View {
        let actionMails = payload.mails.filter { $0.priority == "action" }
        let infoMails = payload.mails.filter { $0.priority != "action" }

        // 返信・対応が必要なメールは最優先なので最上部（LLM がアーカイブ済み含む受信メールから判定）
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

        // 締切 = Canvas 課題のみ（14 日先まで収集）。Google カレンダー終日は下の別グループへ。
        // HOME は「今やるべきこと」のみ表示。完了済みはカレンダータブで確認・解除できる
        let deadlines = payload.deadlines.filter { $0.source == "canvas" && !state.isDeadlineCompleted($0) }
        SectionCard(title: "締切が近い", linkTab: .calendar) {
            if deadlines.isEmpty {
                EmptyRow(message: "直近の締切はありません")
            } else {
                ForEach(deadlines.indices, id: \.self) { i in
                    deadlineRow(deadlines[i])
                }
            }
        }

        // Google カレンダーの終日予定は締切と混ぜず、直近 7 日ぶんだけ別グループで表示
        let calendarAllDay = payload.deadlines.filter {
            $0.source != "canvas" && (BriefingDate.daysUntil($0.dueAt).map { $0 < 7 } ?? false)
        }
        if !calendarAllDay.isEmpty {
            SectionCard(title: "カレンダー（直近7日）", linkTab: .calendar) {
                ForEach(calendarAllDay.indices, id: \.self) { i in
                    deadlineRow(calendarAllDay[i])
                }
            }
        }

        SectionCard(title: "GitHub", linkTab: .github) {
            if payload.todos.isEmpty {
                EmptyRow(message: "TODO は登録されていません")
            } else {
                todoRepoSummaries(payload)
            }
        }
    }

    private func deadlineRow(_ item: DeadlineItem) -> some View {
        let done = state.isDeadlineCompleted(item)
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            // uid がある締切（canvas 由来）だけ手動完了チェックできる
            if let uid = item.uid {
                Button {
                    Task { await state.toggleDeadlineCompleted(uid: uid) }
                } label: {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(done ? Color.doneGreen : Color.secondary)
                }
                .buttonStyle(.plain)
            }
            DuePill(dueAt: item.dueAt)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.title)
                        .font(.subheadline)
                        .strikethrough(done)
                        .foregroundStyle(done ? .secondary : .primary)
                    if let changed = item.changed { ChangeBadge(changed: changed) }
                }
                if let course = item.course, !course.isEmpty {
                    Text(course).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
    }

    /// リポジトリごとの TODO サマリー（タグ + 件数 + LLM サマリー）。
    /// サマリーが無いリポジトリ（旧 payload / 生成失敗）は件数のみ表示にフォールバック。
    /// 並びは todos の初出順（= backend の GITHUB_REPOS 設定順）を保ち、
    /// 6 件目以降は「残り N 件を表示」トグルで展開する。
    private func todoRepoSummaries(_ payload: BriefingPayload) -> some View {
        let byRepo = Dictionary(grouping: payload.todos, by: \.repo)
        var repos: [String] = []
        for todo in payload.todos where !repos.contains(todo.repo) {
            repos.append(todo.repo)
        }
        let summaries = Dictionary(
            (payload.todoSummaries ?? []).map { ($0.repo, $0.summary) },
            uniquingKeysWith: { first, _ in first }
        )
        let visible = showAllGithubRepos ? repos : Array(repos.prefix(Self.githubCollapseLimit))
        return VStack(alignment: .leading, spacing: 12) {
            ForEach(visible, id: \.self) { repo in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        RepoTag(repo: repo)
                        Text("\(byRepo[repo]?.count ?? 0) 件")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    if let summary = summaries[repo], !summary.isEmpty {
                        Text(summary)
                            .font(.subheadline)
                            .lineSpacing(3)
                    }
                }
            }
            if repos.count > Self.githubCollapseLimit {
                Button {
                    withAnimation { showAllGithubRepos.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: showAllGithubRepos ? "chevron.up" : "chevron.down")
                        Text(showAllGithubRepos
                            ? "折りたたむ"
                            : "残り \(repos.count - Self.githubCollapseLimit) 件を表示")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.coralAccent)
                }
                .buttonStyle(.plain)
            }
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
                Text(item.reason).font(.caption).foregroundStyle(Color.coralAccent)
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
