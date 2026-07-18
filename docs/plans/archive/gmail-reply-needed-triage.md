# HOME「要対応」を機能させる: 返信・対応が必要な受信メールを LLM で判定して表示

## 目的・背景

調査（[home-action-mails-verify-and-reorder.md](archive/home-action-mails-verify-and-reorder.md)）の結果、HOME「要対応」は
Gmail コレクタのクエリ `in:inbox newer_than:2d` が前提とする「受信トレイに残っているメール」が
このアカウントには存在しない（受信メールが即アーカイブされる運用）ため、候補が常に 0 件で実質機能していなかった。

ユーザー決定（2026-07-17）: **アーカイブ済みを含む受信メール全般を候補にし、LLM が「返信・対応が必要なもの」を
判定してブリーフィングに表示する**方式にする。

## 対応方針

### Phase 1: Gmail コレクタの収集条件変更（backend）

- `src/collectors/gmail.ts`: クエリを `in:inbox newer_than:Nd` → `newer_than:Nd -in:sent -in:draft -in:chat` に変更
  - INBOX に残っているかに関係なく、直近 N 日の受信メールを候補にする
  - `-in:sent` で自分が送ったメール（Autopilot の自己宛レポート等）を除外（LLM の「除外」規則は保険として残す）
  - スパム・ゴミ箱は Gmail API の既定（includeSpamTrash=false）で除外済み
- `gmail.ts` 冒頭コメント・`config.ts` の `lookbackDays` コメントを「受信トレイ」→「受信メール」に更新

### Phase 2: LLM トリアージ基準を「返信・対応が必要」中心に更新（backend）

- `src/llm/briefing.ts` の SYSTEM_PROMPT:
  - 要対応 (action) の基準を「**返信または対応（手続き・支払い等）が必要なメール**」を軸に書き直す
    （人からの個別メールで返信待ちのもの / 学校事務の手続き依頼 / 支払い・サブスク期限 / セキュリティ警告）
  - 候補が「アーカイブ済み含む受信メール全般」になった前提を明記し、ニュースレター・プロモーション・
    機械的な通知は従来どおり 無視/除外 とする
- `src/llm/check.ts` のフィクスチャに「人からの返信待ちメール」を 1 件追加し、新基準の判定を検証できるようにする

### Phase 3: HOME で「要対応」を最上部へ移動（iOS + spec）

元 TODO「機能していたら1番上に表示する」の実施。

- `ios/AISecretary/Views/HomeView.swift` の `sections()` で「要対応」SectionCard を先頭
  （「締切が近い」の上）へ移動。表示内容・済チェックの挙動は不変
- ファイル冒頭コメントと `docs/specs/ios-app-screens.md` のセクション順記述を更新

## 影響範囲

- backend: `src/collectors/gmail.ts`（クエリ）、`src/llm/briefing.ts`（プロンプトのみ。スキーマ・型は不変）、
  `src/llm/check.ts`（フィクスチャ追加）、`src/config.ts`（コメントのみ）
- iOS: `HomeView.swift`（セクション順のみ）
- payload 構造（`mails: MailItem[]`）・API・DB は不変

## テスト方針

- `npm run typecheck`
- `npm run collectors:check`: Gmail 候補が 0 件でなくなること（直近 2 日に受信メールがある前提）
- `npm run llm:check -- --fixture`: 返信待ちメールが 要対応 に判定されること
- `npm run llm:check`（実データ）: 実際の受信メールでトリアージが機能すること
- iOS: シミュレータビルド（`xcodegen generate` → `xcodebuild ... build`）が通ること

## 結果メモ（2026-07-17 完了）

- Phase 1: クエリを `newer_than:Nd -in:sent -in:draft -in:chat` に変更。gmailLink もアーカイブ済みスレッドを開ける `#all/` に変更。
  `collectors:check` で候補 2 件（Monarch 要確認 + Mackerel ニュースレター）を取得できることを確認（変更前は常に 0 件）
- Phase 2: SYSTEM_PROMPT の action 基準を「返信または対応が必要なメール」を軸に書き直し。
  `llm:check --fixture`: 追加した返信待ち個人メール（m6）が 要対応（reason「返信で日程回答が必要」）、
  Google One / Shoreline も 要対応、Canvas 採点は 参考、NYT/Amazon/Autopilot は落とされることを確認。
  `llm:check`（実データ）: 候補 2 件 → Monarch が 要対応、ニュースレターは落とされることを確認
- Phase 3: HomeView の「要対応」を最上部（締切が近い の上）へ移動。spec 更新。シミュレータビルド成功
- 本番反映は g3plus で git pull（次回 07:00 PT の cron から新ロジックで生成。API サーバの再起動は不要）
