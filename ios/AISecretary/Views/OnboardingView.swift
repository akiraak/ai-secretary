// 初回起動: 通知を許可してデバイストークンを backend に登録する。
// 参照: docs/specs/ios-app-screens.md「1. オンボーディング」
import SwiftUI

struct OnboardingView: View {
    @Environment(AppState.self) private var state
    @State private var requesting = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            Image(systemName: "sun.horizon.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color.amberAccent)
                .padding(.bottom, 16)

            Text("AI秘書")
                .font(.largeTitle.bold())
            Text("毎朝 7:00、その日の要点を 1 通に")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 20) {
                bullet(icon: "calendar", title: "今日の予定",
                       detail: "Google カレンダーの予定をまとめて確認")
                bullet(icon: "graduationcap.fill", title: "Canvas の締切",
                       detail: "提出が近い課題を残日数つきで通知")
                bullet(icon: "envelope.badge.fill", title: "要対応メール",
                       detail: "支払い・学校事務などを Gmail からトリアージ")
            }
            .padding(.horizontal, 36)
            .padding(.top, 40)

            Spacer()

            VStack(spacing: 12) {
                Button {
                    requesting = true
                    Task {
                        await state.requestNotificationsAndRegister()
                        state.onboardingDone = true
                    }
                } label: {
                    Text("通知を許可して始める")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(requesting)

                Button("あとで") {
                    state.onboardingDone = true
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)

                Text("バックエンドの接続先は Setting タブで設定できます")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
    }

    private func bullet(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.amberAccent)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}
