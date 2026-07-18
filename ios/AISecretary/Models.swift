// バックエンドのレスポンス型。backend/src/types.ts / server.ts と 1:1 で対応させる。
import Foundation

/// GET /briefings/latest のレスポンス（server.ts handleLatestBriefing）
struct LatestBriefing: Codable, Equatable {
    let id: Int
    let date: String // America/Los_Angeles の YYYY-MM-DD
    let lang: String
    let title: String?
    let summary: String?
    let payload: BriefingPayload
    let createdAt: String
    let pushedAt: String?
}

/// briefings.payload_json（types.ts BriefingPayload）
struct BriefingPayload: Codable, Equatable {
    let date: String
    let lang: String
    let deadlines: [DeadlineItem]
    let todayEvents: [EventItem]
    /// 収集窓（CALENDAR_LOOKAHEAD_DAYS）内の全予定。週/月表示のデータ源。旧 payload には無い
    let events: [EventItem]?
    /// 前回ブリーフィング以降のカレンダー変更。旧 payload には無い
    let calendarChanges: [CalendarChange]?
    let todos: [TodoItem]
    /// リポジトリごとの TODO.md の LLM サマリー。旧 payload には無く、生成失敗したリポジトリは含まれない
    let todoSummaries: [TodoRepoSummary]?
    /// 更新順リポジトリ一覧（GitHub タブ用）。旧 payload には無い
    let repos: [RepoOverview]?
    let mails: [MailItem]
    let github: [GithubItem]
}

/// Canvas / Calendar から抽出した締切
struct DeadlineItem: Codable, Equatable {
    let source: String // "canvas" | "calendar"
    let title: String
    let dueAt: String // ISO8601 または YYYY-MM-DD（日付のみ）
    let course: String?
    /// ics の UID（event-assignment-<id>）。canvas 由来のみ。手動完了チェックのキー
    let uid: String?
    /// Google Calendar のイベント ID。calendar 由来のみ
    let id: String?
    /// 手動で完了済みにした締切（ブリーフィング生成時点のスナップショット）
    let completed: Bool?
    /// 前回ブリーフィング以降に追加/変更された締切 ("new" | "updated")
    let changed: String?
}

/// 前回ブリーフィング以降のカレンダー変更 1 件
struct CalendarChange: Codable, Equatable {
    let kind: String // "new" | "updated" | "removed"
    let source: String // "calendar" | "canvas"
    let title: String
    let detail: String?
}

/// GET /deadlines のレスポンス（server.ts handleListDeadlines）
struct DeadlinesResponse: Codable, Equatable {
    let collectedAt: String?
    /// 完了済み uid の全リスト（アプリの状態同期はこれを正とする）
    let completedUids: [String]
    let deadlines: [DeadlineItem]
}

/// カレンダーの予定（時刻付きイベント）
struct EventItem: Codable, Equatable {
    /// Google Calendar のイベント ID
    let id: String?
    let title: String
    let startAt: String // ISO8601
    let endAt: String?
    let location: String?
    /// 前回ブリーフィング以降に追加/変更された予定 ("new" | "updated")
    let changed: String?
}

/// 各リポジトリの TODO.md の未完了タスク
struct TodoItem: Codable, Equatable {
    let repo: String
    let text: String
}

/// リポジトリ 1 つ分の TODO.md の LLM サマリー（HOME「GitHub」セクション用）
struct TodoRepoSummary: Codable, Equatable {
    let repo: String
    let summary: String
}

/// Gmail トリアージ結果
struct MailItem: Codable, Equatable {
    let priority: String // "action" | "info"
    let from: String
    let subject: String
    let reason: String
    let gmailLink: String?
}

/// 昨日の GitHub 活動
struct GithubItem: Codable, Equatable {
    let repo: String
    let kind: String // "commit" | "pr"
    let title: String
    let url: String?
}

/// リポジトリ詳細画面用の直近コミット 1 件
struct RepoCommit: Codable, Equatable {
    let message: String // 1 行目のみ
    let date: String // ISO8601
    let url: String?
}

/// リポジトリ 1 つ分の概要（GitHub タブの一覧 + 詳細画面のデータ源）
struct RepoOverview: Codable, Equatable {
    let repo: String // owner/name
    let url: String // https://github.com/owner/name
    let pushedAt: String // ISO8601。更新順ソートキー
    let commits: [RepoCommit] // 直近コミット（最大 10 件）
    let recentSummary: String? // 直近作業の LLM サマリー（生成失敗時は無し）
    let todoRepo: String? // payload.todos / todoSummaries 側のラベル（join 用）
    let todoSummary: String? // todoSummaries から join 済み
    let todoCount: Int // TODO.md の未完了件数（0 = TODO.md 無し）
}

// MARK: - 日付ユーティリティ

enum BriefingDate {
    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static let dateOnly: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current // 日付のみの締切は端末ローカルの「その日」として扱う
        return f
    }()

    /// ISO8601（小数秒あり/なし）→ YYYY-MM-DD の順で試すゆるいパーサ
    static func parse(_ s: String) -> Date? {
        isoWithFraction.date(from: s) ?? iso.date(from: s) ?? dateOnly.date(from: s)
    }

    /// 日付のみ表記（時刻情報なし）か
    static func isDateOnly(_ s: String) -> Bool {
        s.count == 10 && !s.contains("T")
    }

    /// 今日から締切までの残日数（暦日差）。パース不能なら nil
    static func daysUntil(_ s: String) -> Int? {
        guard let date = parse(s) else { return nil }
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: date)).day
    }

    /// 締切ピルの文言（期限切れ / 今日 / 明日 / あとN日）
    static func dueLabel(_ s: String) -> String {
        guard let days = daysUntil(s) else { return "" }
        switch days {
        case ..<0: return "期限切れ"
        case 0: return "今日"
        case 1: return "明日"
        default: return "あと\(days)日"
        }
    }

    /// 過去時刻の相対表記（今日 / 昨日 / N日前）。リポジトリ一覧の更新時刻用
    static func agoLabel(_ s: String) -> String {
        guard let date = parse(s) else { return "" }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: date), to: cal.startOfDay(for: .now)).day ?? 0
        switch days {
        case ..<1: return "今日"
        case 1: return "昨日"
        default: return "\(days)日前"
        }
    }

    /// "HH:mm" 表記（日付のみなら「終日」）
    static func timeLabel(_ s: String) -> String {
        if isDateOnly(s) { return "終日" }
        guard let date = parse(s) else { return "" }
        return date.formatted(date: .omitted, time: .shortened)
    }

    /// "7月15日(火)" 表記（HOME の大タイトル用）
    static func longDayLabel(_ s: String) -> String {
        guard let date = parse(s) else { return s }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.dateFormat = "M月d日(E)"
        return f.string(from: date)
    }
}
