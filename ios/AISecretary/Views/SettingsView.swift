// Setting タブ = バックエンド接続・通知/デバイス登録状態・連携ソースの案内。
// マスターデータの編集は持たない（設定は最小限）。参照: docs/specs/ios-app-screens.md
import SwiftUI
import UserNotifications

struct SettingsView: View {
    @Environment(AppState.self) private var state
    @State private var testResult: String?
    @State private var testing = false

    var body: some View {
        @Bindable var state = state
        NavigationStack {
            Form {
                Section {
                    TextField("URL（例: http://g3plus:8787）", text: $state.backendURLString)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("API 共有シークレット", text: $state.sharedSecret)
                    Button {
                        testing = true
                        Task {
                            await runConnectionTest()
                            testing = false
                        }
                    } label: {
                        HStack {
                            Text("接続テスト")
                            if testing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(testing || !state.isConfigured)
                    if let testResult {
                        Text(testResult)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("バックエンド接続")
                } footer: {
                    Text("backend の .env の API_SHARED_SECRET と同じ値を入れます")
                }

                Section("通知 / デバイス") {
                    LabeledContent("通知許可", value: notificationStatusLabel)
                    if state.notificationStatus == .notDetermined {
                        Button("通知を許可する") {
                            Task { await state.requestNotificationsAndRegister() }
                        }
                    } else if state.notificationStatus == .denied {
                        Button("設定アプリで通知を許可する") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                    }
                    LabeledContent("デバイストークン", value: tokenLabel)
                    LabeledContent("バックエンド登録", value: state.isDeviceRegistered ? "登録済み" : "未登録")
                    Button("デバイスを再登録") {
                        Task {
                            await state.requestNotificationsAndRegister()
                            await state.registerDeviceIfPossible(force: true)
                        }
                    }
                    .disabled(!state.isConfigured)
                }

                Section {
                    LabeledContent("配信時刻", value: "07:00（シアトル時間）")
                    LabeledContent("言語", value: "日本語")
                } header: {
                    Text("配信")
                } footer: {
                    Text("変更は backend の .env（BRIEFING_HOUR / TZ / BRIEFING_LANG）で行います")
                }

                Section {
                    sourceRow(icon: "calendar", name: "Google カレンダー")
                    sourceRow(icon: "envelope.fill", name: "Gmail")
                    sourceRow(icon: "graduationcap.fill", name: "Canvas（iCal）")
                    sourceRow(icon: "chevron.left.forwardslash.chevron.right", name: "GitHub・TODO.md")
                } header: {
                    Text("連携ソース")
                } footer: {
                    Text("接続の設定・トリアージ基準は backend 側（.env / プロンプト）で管理します")
                }

                Section("情報") {
                    LabeledContent("バージョン", value: appVersion)
                    LabeledContent("Bundle ID", value: Bundle.main.bundleIdentifier ?? "-")
                }
            }
            .navigationTitle("Setting")
        }
        .task { await state.refreshNotificationStatus() }
    }

    private var notificationStatusLabel: String {
        switch state.notificationStatus {
        case .authorized, .provisional, .ephemeral: return "許可済み"
        case .denied: return "拒否"
        case .notDetermined: return "未確認"
        @unknown default: return "不明"
        }
    }

    private var tokenLabel: String {
        guard let token = state.deviceToken else { return "未取得" }
        return "…" + token.suffix(8)
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "-"
        return "\(version) (\(build))"
    }

    private func sourceRow(icon: String, name: String) -> some View {
        Label(name, systemImage: icon)
    }

    private func runConnectionTest() async {
        guard let client = state.client else { return }
        do {
            if let briefing = try await client.fetchLatestBriefing() {
                testResult = "✓ 接続 OK（最新ブリーフィング: \(briefing.date)）"
            } else {
                testResult = "✓ 接続 OK（ブリーフィングはまだありません）"
            }
        } catch {
            testResult = "✗ \(error.localizedDescription)"
        }
    }
}
