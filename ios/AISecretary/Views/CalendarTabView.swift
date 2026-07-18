// Calendar タブ = 週/月カレンダー + 選択日の予定・締切 + カレンダーの変更 + 今後の締切一覧。
// データ源は payload.events（収集窓 CALENDAR_LOOKAHEAD_DAYS 分。旧 payload は todayEvents に
// フォールバック）+ payload.deadlines。参照: docs/specs/ios-app-screens.md
import SwiftUI

struct CalendarTabView: View {
    @Environment(AppState.self) private var state
    @State private var mode: Mode = .week
    @State private var selectedDay: Date = Calendar.current.startOfDay(for: .now)
    @State private var monthAnchor: Date = CalendarTabView.firstOfMonth(.now)

    enum Mode: String, CaseIterable {
        case week = "週"
        case month = "月"
    }

    var body: some View {
        NavigationStack {
            List {
                changesSection
                calendarSection
                selectedDaySection
                deadlinesSection
            }
            .navigationTitle("Calendar")
            .refreshable { await state.refreshBriefing() }
            .onChange(of: mode) {
                if mode == .month { monthAnchor = Self.firstOfMonth(selectedDay) }
            }
        }
    }

    private var payload: BriefingPayload? { state.briefing?.payload }

    // MARK: データの日別グルーピング

    private var calendar: Calendar { Calendar.current }
    private var todayStart: Date { calendar.startOfDay(for: .now) }

    /// 週/月表示のデータ源。旧 payload（events なし）は今日の予定のみで表示する
    private var allEvents: [EventItem] {
        let events = payload?.events ?? []
        return events.isEmpty ? (payload?.todayEvents ?? []) : events
    }

    private func dayKey(_ s: String) -> Date? {
        BriefingDate.parse(s).map { calendar.startOfDay(for: $0) }
    }

    private var eventsByDay: [Date: [EventItem]] {
        var dict: [Date: [EventItem]] = [:]
        for e in allEvents {
            if let day = dayKey(e.startAt) { dict[day, default: []].append(e) }
        }
        return dict
    }

    private var deadlinesByDay: [Date: [DeadlineItem]] {
        var dict: [Date: [DeadlineItem]] = [:]
        for d in payload?.deadlines ?? [] {
            if let day = dayKey(d.dueAt) { dict[day, default: []].append(d) }
        }
        return dict
    }

    // MARK: カレンダーの変更（前回ブリーフィング以降）

    @ViewBuilder
    private var changesSection: some View {
        if let changes = payload?.calendarChanges, !changes.isEmpty {
            Section("カレンダーの変更") {
                ForEach(changes.indices, id: \.self) { i in
                    CalendarChangeRow(change: changes[i])
                }
            }
        }
    }

    // MARK: 週/月カレンダー

    private var calendarSection: some View {
        Section {
            VStack(spacing: 12) {
                Picker("表示", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)

                if mode == .week {
                    weekStrip
                } else {
                    monthGrid
                }
            }
            .padding(.vertical, 4)
        }
    }

    /// 今日を先頭にした 7 日分の横ストリップ
    private var weekStrip: some View {
        HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { offset in
                if let day = calendar.date(byAdding: .day, value: offset, to: todayStart) {
                    dayCell(day, showWeekday: true)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private var monthGrid: some View {
        VStack(spacing: 8) {
            HStack {
                Button { moveMonth(by: -1) } label: {
                    Image(systemName: "chevron.left").font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.amberAccent)
                Spacer()
                Text(Self.monthTitleFmt.string(from: monthAnchor))
                    .font(.subheadline.weight(.bold))
                Spacer()
                Button { moveMonth(by: 1) } label: {
                    Image(systemName: "chevron.right").font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.amberAccent)
            }
            .padding(.horizontal, 4)

            let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(weekdaySymbols.indices, id: \.self) { i in
                    Text(weekdaySymbols[i])
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ForEach(monthDays().indices, id: \.self) { i in
                    if let day = monthDays()[i] {
                        dayCell(day, showWeekday: false)
                    } else {
                        Color.clear.frame(height: 40)
                    }
                }
            }
        }
    }

    /// 日セル（週: 曜日付き / 月: 日数字のみ）。タップで選択日を切り替える
    private func dayCell(_ day: Date, showWeekday: Bool) -> some View {
        let selected = day == selectedDay
        let isToday = day == todayStart
        let hasEvents = !(eventsByDay[day] ?? []).isEmpty
        let hasDeadlines = !(deadlinesByDay[day] ?? []).isEmpty

        return VStack(spacing: 3) {
            if showWeekday {
                Text(Self.weekdayFmt.string(from: day))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text("\(calendar.component(.day, from: day))")
                .font(.subheadline.monospacedDigit().weight(selected || isToday ? .bold : .regular))
                .foregroundStyle(selected ? .white : (isToday ? Color.amberAccent : .primary))
                .frame(width: 32, height: 32)
                .background(
                    selected ? Color.amberAccent : (isToday ? Color.amberAccent.opacity(0.15) : .clear),
                    in: Circle()
                )
            HStack(spacing: 3) {
                if hasEvents { Circle().fill(Color.amberAccent).frame(width: 4, height: 4) }
                if hasDeadlines { Circle().fill(Color.deadlineRed).frame(width: 4, height: 4) }
            }
            .frame(height: 4)
        }
        .contentShape(Rectangle())
        .onTapGesture { selectedDay = day }
    }

    private func moveMonth(by value: Int) {
        if let moved = calendar.date(byAdding: .month, value: value, to: monthAnchor) {
            monthAnchor = Self.firstOfMonth(moved)
        }
    }

    /// 表示中の月のセル並び（先頭は前月ぶんの空セル）
    private func monthDays() -> [Date?] {
        guard let range = calendar.range(of: .day, in: .month, for: monthAnchor) else { return [] }
        let firstWeekday = calendar.component(.weekday, from: monthAnchor)
        let leading = (firstWeekday - calendar.firstWeekday + 7) % 7
        var cells: [Date?] = Array(repeating: nil, count: leading)
        for offset in 0..<range.count {
            cells.append(calendar.date(byAdding: .day, value: offset, to: monthAnchor))
        }
        return cells
    }

    /// 端末の週開始設定に合わせて並べ替えた曜日見出し
    private var weekdaySymbols: [String] {
        let base = ["日", "月", "火", "水", "木", "金", "土"]
        let start = calendar.firstWeekday - 1 // firstWeekday は 1=日曜
        return (0..<7).map { base[($0 + start) % 7] }
    }

    // MARK: 選択日の予定・締切

    @ViewBuilder
    private var selectedDaySection: some View {
        let events = (eventsByDay[selectedDay] ?? []).sorted { $0.startAt < $1.startAt }
        let deadlines = deadlinesByDay[selectedDay] ?? []
        Section(Self.dayTitleFmt.string(from: selectedDay)) {
            if events.isEmpty && deadlines.isEmpty {
                EmptyRow(message: "この日の予定・締切はありません")
            } else {
                ForEach(events.indices, id: \.self) { i in
                    eventRow(events[i])
                }
                ForEach(deadlines.indices, id: \.self) { i in
                    deadlineRow(deadlines[i])
                }
            }
        }
    }

    private func eventRow(_ event: EventItem) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(BriefingDate.timeLabel(event.startAt))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(Color.amberAccent)
                .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(event.title).font(.subheadline)
                    if let changed = event.changed { ChangeBadge(changed: changed) }
                }
                if let location = event.location, !location.isEmpty {
                    Label(location, systemImage: "mappin")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.title)
                        .font(.subheadline)
                        .strikethrough(done)
                        .foregroundStyle(done ? .secondary : .primary)
                    if let changed = item.changed { ChangeBadge(changed: changed) }
                }
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

    // MARK: 今後の締切一覧

    @ViewBuilder
    private var deadlinesSection: some View {
        // 締切 = Canvas 課題のみ。未完了を先頭に、完了済みは下へまとめる。各グループ内は dueAt 昇順
        let deadlines = (payload?.deadlines ?? []).filter { $0.source == "canvas" }.sorted { a, b in
            let aDone = state.isDeadlineCompleted(a)
            let bDone = state.isDeadlineCompleted(b)
            if aDone != bDone { return !aDone }
            return (BriefingDate.parse(a.dueAt) ?? .distantFuture) < (BriefingDate.parse(b.dueAt) ?? .distantFuture)
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

        // Google カレンダーの終日予定は別グループ。直近 7 日ぶんのみ dueAt 昇順で表示
        let calendarAllDay = (payload?.deadlines ?? [])
            .filter { $0.source != "canvas" && (BriefingDate.daysUntil($0.dueAt).map { $0 < 7 } ?? false) }
            .sorted {
                (BriefingDate.parse($0.dueAt) ?? .distantFuture) < (BriefingDate.parse($1.dueAt) ?? .distantFuture)
            }
        if !calendarAllDay.isEmpty {
            Section("カレンダー（直近7日）") {
                ForEach(calendarAllDay.indices, id: \.self) { i in
                    deadlineRow(calendarAllDay[i])
                }
            }
        }
    }

    // MARK: 日付フォーマッタ

    private static func firstOfMonth(_ date: Date) -> Date {
        let cal = Calendar.current
        return cal.date(from: cal.dateComponents([.year, .month], from: date)) ?? date
    }

    private static let weekdayFmt: DateFormatter = jaFormatter("E")
    private static let dayTitleFmt: DateFormatter = jaFormatter("M月d日(E)")
    private static let monthTitleFmt: DateFormatter = jaFormatter("yyyy年M月")

    private static func jaFormatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.dateFormat = format
        return f
    }
}
