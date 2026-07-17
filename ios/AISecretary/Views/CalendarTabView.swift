// Calendar タブ = 今日の予定 + 今後の締切（Google 予定 + Canvas 締切を時系列で）。
// 週ストリップ表示は後フェーズ。参照: docs/specs/ios-app-screens.md
import SwiftUI

struct CalendarTabView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        NavigationStack {
            List {
                eventsSection
                deadlinesSection
            }
            .navigationTitle("Calendar")
            .refreshable { await state.refreshBriefing() }
        }
    }

    private var payload: BriefingPayload? { state.briefing?.payload }

    @ViewBuilder
    private var eventsSection: some View {
        let events = payload?.todayEvents ?? []
        Section("今日の予定") {
            if events.isEmpty {
                EmptyRow(message: "今日の予定はありません")
            } else {
                ForEach(events.indices, id: \.self) { i in
                    let event = events[i]
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(BriefingDate.timeLabel(event.startAt))
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(Color.amberAccent)
                            .frame(width: 52, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title).font(.subheadline)
                            if let location = event.location, !location.isEmpty {
                                Label(location, systemImage: "mappin")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
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
                Text(item.title)
                    .font(.subheadline)
                    .strikethrough(done)
                    .foregroundStyle(done ? .secondary : .primary)
                HStack(spacing: 6) {
                    if let course = item.course, !course.isEmpty {
                        Text(course)
                    }
                    Text(item.source == "canvas" ? "Canvas" : "カレンダー")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    @ViewBuilder
    private var deadlinesSection: some View {
        let deadlines = (payload?.deadlines ?? []).sorted {
            (BriefingDate.parse($0.dueAt) ?? .distantFuture) < (BriefingDate.parse($1.dueAt) ?? .distantFuture)
        }
        Section("今後の締切") {
            if deadlines.isEmpty {
                EmptyRow(message: "直近の締切はありません")
            } else {
                ForEach(deadlines.indices, id: \.self) { i in
                    deadlineRow(deadlines[i])
                }
            }
        }
    }
}
