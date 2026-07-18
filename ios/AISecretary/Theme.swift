// 配色: 秘書キャラクター（secretary.png）モチーフ。暖色の紙地 × コーラルアクセント。
// アクセントが赤系のため、締切=赤 と衝突する箇所は neutralPill（グレー）で分離する。
// 参照: docs/specs/ios-app-screens.md「デザイン方針」/ docs/plans/archive/app-theme-coral.md
import SwiftUI
import UIKit

extension Color {
    static let appBackground = dynamic(light: 0xFAF3F0, dark: 0x201618)
    static let cardBackground = dynamic(light: 0xFFFFFF, dark: 0x2C2125)
    /// dark はキャラ画像の実測色 #F85D67。light は白地の文字コントラスト確保のため暗め
    static let coralAccent = dynamic(light: 0xD63844, dark: 0xF85D67)
    static let neutralPill = dynamic(light: 0x6B7280, dark: 0x4B5563)
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
