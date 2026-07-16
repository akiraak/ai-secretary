// 画面横断で使う小さな表示部品（残日数ピル / リポジトリタグ / セクションカード / 空表示）。
import SwiftUI

/// 締切の残日数ピル。2日以内は赤、それ以外は琥珀
struct DuePill: View {
    let dueAt: String

    var body: some View {
        let days = BriefingDate.daysUntil(dueAt)
        let urgent = (days ?? 0) <= 2
        Text(BriefingDate.dueLabel(dueAt))
            .font(.caption.weight(.semibold).monospacedDigit())
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(urgent ? Color.deadlineRed : Color.amberAccent, in: Capsule())
    }
}

/// リポジトリ名タグ（等幅・開発系は青）
struct RepoTag: View {
    let repo: String

    var body: some View {
        Text(repo)
            .font(.caption.monospaced())
            .foregroundStyle(Color.repoBlue)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.repoBlue.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
    }
}

/// HOME のセクションカード。見出しの「›」で対応タブへ飛べる
struct SectionCard<Content: View>: View {
    let title: String
    var linkTab: AppTab?
    @ViewBuilder let content: Content
    @Environment(AppState.self) private var state

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let linkTab {
                Button {
                    state.selectedTab = linkTab
                } label: {
                    HStack(spacing: 4) {
                        header
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            } else {
                header
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.cardBackground, in: RoundedRectangle(cornerRadius: 14))
    }

    private var header: some View {
        Text(title)
            .font(.subheadline.weight(.bold))
            .foregroundStyle(.secondary)
    }
}

/// データがないときの控えめな空表示
struct EmptyRow: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.tertiary)
    }
}
