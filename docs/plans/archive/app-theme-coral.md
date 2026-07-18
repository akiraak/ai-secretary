# アプリの背景色・デザイン変更（コーラルテーマ）

## 目的・背景

- ユーザー提供の秘書キャラクター画像（`/Users/akiraak/Downloads/secretary.png`、コーラルレッド #F85D67 のシルエット）をアプリの顔として採用することになった
- 現行の「スレート地 × 琥珀アクセント」から、この画像に合わせた「暖色の紙地 × コーラルアクセント」へ全体配色を変更する
- 同画像はアプリアイコンにも採用（[app-icon-redesign.md](app-icon-redesign.md) 参照）

## 対応方針

### 配色（Theme.swift / AccentColor.colorset）

| 色 | light | dark | 備考 |
|---|---|---|---|
| appBackground | 0xFAF3F0 | 0x201618 | 冷たいスレート → 暖色の紙地 |
| cardBackground | 0xFFFFFF | 0x2C2125 | dark のみ暖色寄りに |
| coralAccent（旧 amberAccent） | 0xD63844 | 0xF85D67 | light は白地の文字用に暗め（コントラスト 4.6:1）。dark は画像の実測色そのまま |
| neutralPill（新設） | 0x6B7280 | 0x4B5563 | 下記「赤の衝突回避」用 |
| deadlineRed / doneGreen / repoBlue | 不変 | 不変 | セマンティックカラーは維持 |

### 赤の衝突回避

アクセントが赤系（コーラル）になるため、「締切=赤」との見分けがつかなくなる箇所を分離する:

- DuePill（残日数ピル）: 非緊急側を琥珀 → **neutralPill（グレー）** に変更。緊急=赤だけが赤く残り、逼迫が今まで以上に際立つ
- ChangeBadge（新規=緑 / 変更=アクセント）と Calendar の日付ドットは色相の役割が近接しないためアクセント置換のみ

### オンボーディング

- ヘッダーの SF Symbol（sun.horizon.fill）を秘書キャラ画像に差し替える
- 画像は白背景のため、緑チャンネルからアルファマットを抽出して透過 PNG 化し `Secretary.imageset` として追加（生成手順はこのプランに記録）

## 影響範囲

- `ios/AISecretary/Theme.swift`・`Assets.xcassets`（AccentColor / Secretary 追加）
- `amberAccent` 参照箇所の一括リネーム（Components / Home / Calendar / GitHub / RepoDetail / Onboarding / App）
- backend・payload は不変

## テスト方針

- シミュレータビルド成功 + ライト / ダーク両モードでの表示確認
- 実機は `./run-ios-device.sh` で確認

## 決定記録

- 2026-07-18: ユーザーが secretary.png を添付して着手指示。主要色の実測値は #F85D67
