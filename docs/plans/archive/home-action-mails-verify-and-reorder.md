# HOME「要対応」の機能確認 + 最上部への移動

## 目的・背景

TODO: 「home の要対応は機能しているか確認。機能していたら1番上に表示する」

HOME の「要対応」セクションは Gmail コレクタ（`backend/src/collectors/gmail.ts`）→ LLM トリアージ（`backend/src/llm/briefing.ts`、action / info のみ `payload.mails` に残す）→ iOS `HomeView.sections()` の `payload.mails` 表示、というパイプラインで動く想定。現在 HOME では 4 番目（締切が近い → カレンダー（直近7日） → GitHub → 要対応）に表示されている。

## 対応方針

### Phase 1: 機能確認（調査）

1. 本番 API `GET https://secretary.chobi.me/briefings/latest`（Bearer は `backend/.env` の `API_SHARED_SECRET`）で最新ブリーフィングの `payload.mails` を確認する
   - mails に要対応 (action) / 参考 (info) が入っていればパイプラインは機能している
   - 空の場合は「たまたま該当メールが無い」のか「壊れている」のかを切り分けるため、ローカルで `npm run collectors:check`（Gmail コレクタの実データ取得）を実行して候補が取れることを確認する
2. 判定結果をこのプランに追記する

### Phase 2: HOME で最上部に移動（Phase 1 で機能していると判定できた場合のみ）

- `ios/AISecretary/Views/HomeView.swift` の `sections()` で「要対応」SectionCard を先頭（「締切が近い」の上）へ移動する。表示内容・doneMails の挙動は不変
- ファイル先頭コメントのセクション順記述を更新する
- `docs/specs/ios-app-screens.md` の HOME セクション順の記述を更新する
- backend・payload は不変

## 影響範囲

- `ios/AISecretary/Views/HomeView.swift`（セクション順のみ）
- `docs/specs/ios-app-screens.md`（記述更新）
- backend は変更なし

## テスト方針

- Phase 1: 本番 API のレスポンス実物 + 必要なら `collectors:check` の出力で判断
- Phase 2: シミュレータビルド（`xcodegen generate` → `xcodebuild ... -destination 'platform=iOS Simulator,name=iPhone 17' build`）が通ること

## 結果メモ（2026-07-17 調査完了）

判定: **「要対応」は実質機能していない**（パイプラインのコード自体は正常だが、候補が常に 0 件になる）。
Phase 2（最上部への移動）は「機能していたら」の条件不成立のため実施しない。

確認した事実:

- 本番 API `GET /briefings/latest`（2026-07-17 分）: `payload.mails` は 0 件
- `npm run collectors:check`: `[Gmail] 受信候補 0 件（直近 2 日）` — コレクタの実行・認証自体は成功
- `npm run llm:check -- --fixture`: フィクスチャ候補から要対応 2 件（Google One 支払い / Shoreline 学校事務）を正しく判定 — LLM トリアージ層は正常
- Gmail を直接照合（Claude の Gmail コネクタ、同一アカウント akiraak@gmail.com）:
  - `in:inbox newer_than:14d` → **0 件**
  - `newer_than:7d`（in:inbox なし）→ 32 スレッド。受信メール（Monarch の要確認通知・学校事務 pio@shoreline.edu・セキュリティ通知等を含む）はどれも INBOX ラベルを持たない

原因: コレクタのクエリ `in:inbox newer_than:2d`（`backend/src/collectors/gmail.ts`）は「受信トレイに残っているメール」前提だが、このアカウントは受信メールが即アーカイブされる運用（フィルタ等）で INBOX が常に空。そのため候補が永続的に 0 件 → HOME の要対応は常に「要対応のメールはありません」になる。

対応案（別タスク化。どちらにするかはユーザー判断）:

1. コレクタのクエリを `newer_than:2d -in:sent -in:draft` 等へ変更し、アーカイブ済み受信メールも候補にする（ニュースレター等のノイズは LLM トリアージが 無視/除外 で落とす設計のため整合的）
2. Gmail 側のフィルタ運用を見直し、重要メールを INBOX に残す

機能するようになったら、本プラン Phase 2 のとおり「要対応」を HOME 最上部へ移動する。
