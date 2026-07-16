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

    // MARK: 実行時状態

    var selectedTab: AppTab = .home
    /// APNs から受け取ったデバイストークン（hex）
    private(set) var deviceToken: String?
    private(set) var notificationStatus: UNAuthorizationStatus = .notDetermined
    private(set) var briefing: LatestBriefing?
    private(set) var isRefreshing = false
    var lastErrorMessage: String?

    private let defaults = UserDefaults.standard

    init() {
        backendURLString = defaults.string(forKey: "backendURL") ?? ""
        sharedSecret = defaults.string(forKey: "sharedSecret") ?? ""
        onboardingDone = defaults.bool(forKey: "onboardingDone")
        registeredToken = defaults.string(forKey: "registeredToken")
    }

    /// 接続設定が揃っていれば API クライアントを返す
    var client: BackendClient? {
        BackendClient.make(urlString: backendURLString, secret: sharedSecret)
    }

    var isConfigured: Bool { client != nil }

    var isDeviceRegistered: Bool {
        deviceToken != nil && deviceToken == registeredToken
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
        if !force && token == registeredToken { return }
        do {
            try await client.registerDevice(token: token)
            registeredToken = token
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
            // 設定変更後の取り直しついでに、未登録トークンがあれば登録も試みる
            await registerDeviceIfPossible()
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    /// 通知タップ → HOME を開いて最新を取り直す
    func handleNotificationTap() {
        selectedTab = .home
        Task { await refreshBriefing() }
    }
}
