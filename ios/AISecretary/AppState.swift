// アプリ全体の状態。設定は UserDefaults に永続化する
// （単一ユーザー・個人端末前提の MVP。シークレットの Keychain 化は後続）。
import SwiftUI
import UserNotifications
import Observation

enum AppTab: Hashable {
    case home, github, calendar, settings
}

@MainActor
@Observable
final class AppState {
    static let shared = AppState()

    // MARK: 設定（UserDefaults 永続化）

    var backendURLString: String {
        didSet { defaults.set(backendURLString, forKey: "backendURL") }
    }
    var sharedSecret: String {
        didSet { defaults.set(sharedSecret, forKey: "sharedSecret") }
    }
    var onboardingDone: Bool {
        didSet { defaults.set(onboardingDone, forKey: "onboardingDone") }
    }
    /// POST /devices 済みのトークン（再登録の要否判定に使う）
    private(set) var registeredToken: String? {
        didSet { defaults.set(registeredToken, forKey: "registeredToken") }
    }
    /// 登録先バックエンドの URL（ローカル ⇄ 本番の切替時に再登録が要るため）
    private(set) var registeredBackend: String? {
        didSet { defaults.set(registeredBackend, forKey: "registeredBackend") }
    }

    // MARK: 実行時状態

    var selectedTab: AppTab = .home
    /// APNs から受け取ったデバイストークン（hex）
    private(set) var deviceToken: String?
    private(set) var notificationStatus: UNAuthorizationStatus = .notDetermined
    private(set) var briefing: LatestBriefing?
    private(set) var isRefreshing = false
    var lastErrorMessage: String?
    /// 手動完了済みの締切 uid（サーバの deadline_completions と同期）
    private(set) var completedDeadlineUids: Set<String> = []
    /// 完了チェックの通信中 uid（連打防止）
    private var togglingDeadlineUids: Set<String> = []

    private let defaults = UserDefaults.standard

    init() {
        // Setting タブで未編集（保存値なし・空）の間は Info.plist の焼き込み値を既定にする。
        // didSet は init では発火しないため保存されず、リビルドで新しい焼き込み値に追従する。
        backendURLString = Self.storedOrBaked(defaults, key: "backendURL", infoKey: "BackendBaseURL")
        sharedSecret = Self.storedOrBaked(defaults, key: "sharedSecret", infoKey: "BackendAPISecret")
        onboardingDone = defaults.bool(forKey: "onboardingDone")
        registeredToken = defaults.string(forKey: "registeredToken")
        registeredBackend = defaults.string(forKey: "registeredBackend")
    }

    /// UserDefaults の保存値が空でなければそれを、なければビルド時に
    /// Info.plist へ埋め込まれた値（run-ios-device.sh が注入）を返す
    private static func storedOrBaked(_ defaults: UserDefaults, key: String, infoKey: String) -> String {
        if let stored = defaults.string(forKey: key), !stored.isEmpty {
            return stored
        }
        return (Bundle.main.object(forInfoDictionaryKey: infoKey) as? String) ?? ""
    }

    /// 接続設定が揃っていれば API クライアントを返す
    var client: BackendClient? {
        BackendClient.make(urlString: backendURLString, secret: sharedSecret)
    }

    var isConfigured: Bool { client != nil }

    var isDeviceRegistered: Bool {
        deviceToken != nil && deviceToken == registeredToken && backendURLString == registeredBackend
    }

    // MARK: 通知・デバイス登録

    func refreshNotificationStatus() async {
        notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// 通知許可を求め、APNs へのリモート通知登録を開始する（オンボーディング・Setting から呼ぶ）
    func requestNotificationsAndRegister() async {
        do {
            _ = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])
        } catch {
            lastErrorMessage = "通知許可のリクエストに失敗しました: \(error.localizedDescription)"
        }
        await refreshNotificationStatus()
        // 許可が下りなくてもトークンは取得できる（サイレント配送用）。登録は常に試みる
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// AppDelegate から: APNs トークンを受け取ったら保持して backend へ登録
    func handleDeviceToken(_ tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        Task { await registerDeviceIfPossible() }
    }

    /// AppDelegate から: リモート通知登録の失敗
    func handleRegistrationError(_ error: Error) {
        lastErrorMessage = "リモート通知の登録に失敗しました: \(error.localizedDescription)"
    }

    /// トークンと接続設定が揃っていれば POST /devices する（force = 登録済みでも再送）
    func registerDeviceIfPossible(force: Bool = false) async {
        guard let token = deviceToken, let client else { return }
        if !force && token == registeredToken && backendURLString == registeredBackend { return }
        do {
            try await client.registerDevice(token: token)
            registeredToken = token
            registeredBackend = backendURLString
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = "デバイス登録に失敗しました: \(error.localizedDescription)"
        }
    }

    // MARK: ブリーフィング取得

    func refreshBriefing() async {
        guard let client else {
            lastErrorMessage = "Setting タブでバックエンドの URL と共有シークレットを設定してください"
            return
        }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            briefing = try await client.fetchLatestBriefing()
            lastErrorMessage = briefing == nil
                ? "まだブリーフィングがありません（backend で npm run briefing を実行）"
                : nil
            await syncDeadlineCompletions()
            // 設定変更後の取り直しついでに、未登録トークンがあれば登録も試みる
            await registerDeviceIfPossible()
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    // MARK: 締切の手動完了チェック

    /// サーバから完了状態を取り直す。失敗時は payload のスナップショットへフォールバック
    func syncDeadlineCompletions() async {
        guard let client else { return }
        do {
            completedDeadlineUids = Set(try await client.fetchDeadlines().completedUids)
        } catch {
            completedDeadlineUids = Set(
                (briefing?.payload.deadlines ?? [])
                    .filter { $0.completed == true }
                    .compactMap(\.uid)
            )
        }
    }

    func isDeadlineCompleted(_ item: DeadlineItem) -> Bool {
        guard let uid = item.uid else { return false }
        return completedDeadlineUids.contains(uid)
    }

    /// 完了チェックをトグルする（楽観的更新。失敗時は元に戻してエラー表示）
    func toggleDeadlineCompleted(uid: String) async {
        guard let client, !togglingDeadlineUids.contains(uid) else { return }
        let newValue = !completedDeadlineUids.contains(uid)
        togglingDeadlineUids.insert(uid)
        defer { togglingDeadlineUids.remove(uid) }

        if newValue { completedDeadlineUids.insert(uid) } else { completedDeadlineUids.remove(uid) }
        do {
            try await client.setDeadlineCompleted(uid: uid, completed: newValue)
        } catch {
            if newValue { completedDeadlineUids.remove(uid) } else { completedDeadlineUids.insert(uid) }
            lastErrorMessage = "締切の完了チェックを保存できませんでした: \(error.localizedDescription)"
        }
    }

    /// 通知タップ → HOME を開いて最新を取り直す
    func handleNotificationTap() {
        selectedTab = .home
        Task { await refreshBriefing() }
    }
}
