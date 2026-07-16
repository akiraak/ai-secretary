// 配色: 夜明けの光モチーフ（クールなスレート地 × 琥珀アクセント）。
// 締切=赤 / 完了=緑 のセマンティックカラーはアクセントと分離する。
// 参照: docs/specs/ios-app-screens.md「デザイン方針」
import SwiftUI
import UIKit

extension Color {
    static let appBackground = dynamic(light: 0xF2F4F7, dark: 0x0F172A)
    static let cardBackground = dynamic(light: 0xFFFFFF, dark: 0x1E293B)
    static let amberAccent = dynamic(light: 0xC2620E, dark: 0xF59E0B)
    static let deadlineRed = dynamic(light: 0xDC2626, dark: 0xF87171)
    static let doneGreen = dynamic(light: 0x16A34A, dark: 0x4ADE80)
    static let repoBlue = dynamic(light: 0x2563EB, dark: 0x60A5FA)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}
