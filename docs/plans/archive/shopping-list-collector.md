# kitchen-living の買い物リストを取得して HOME に表示

## 目的・背景

- 家庭の共有買い物リスト（kitchen-living）が JSON API で取得できるようになった
  - `https://kitchen.chobi.me/shopping-list?token=<token>`（token は `backend/.env` の `SHOPPING_LIST_URL` に URL ごと保存。git 管理外）
  - レスポンス: `{ updatedAt, dishes, items: [{ id, name, checked, origin: "recipe"|"manual", createdAt(ms), completedAt?(ms) }] }`
  - `checked: false` が未購入 = 買うべきもの
- 朝のブリーフィングに未購入品を載せ、HOME で確認できるようにする

## 対応方針

### backend

- `config.ts`: `shopping.listUrl`（env `SHOPPING_LIST_URL`、未設定可）を追加。`.env.example` にも追記
- `collectors/shopping.ts` 新規: fetch → `checked === false` のみ抽出 → `createdAt` 昇順（追加順）→ `ShoppingItem[]`
  - `ShoppingItem = { name, origin?, createdAt?(ISO8601) }`（types.ts）
  - タイムアウト 15 秒。URL 未設定・非 2xx はエラー（collectAll の warnings に落ちる）
- `collectors/all.ts`: `CollectedInput.shopping?: ShoppingItem[]` を追加。失敗時は `undefined`
  （repoOverviews と同じ方式。payload に `shopping` が無ければ iOS はセクション非表示）
- `llm/briefing.ts`: payload 組み立てに `shopping: input.shopping` を追加
  - **LLM プロンプトには入れない**（要約は予定・締切・要対応メール中心のまま。将来必要なら別途）
- `jobs/runBriefing.ts`: `collectorRunsFrom` に `source: 'shopping'` を追加、収集ログに件数を出す
- `collectors/check.ts`: 買い物リストの確認ブロックを追加

### iOS

- `Models.swift`: `ShoppingItem` 追加、`BriefingPayload.shopping: [ShoppingItem]?`（旧 payload には無い）
- `HomeView.swift`: 「カレンダー（直近7日）」と「GitHub」の間に「買い物リスト」セクションを追加
  - `payload.shopping` が無い（旧 payload / コレクタ失敗）または空なら非表示
  - 行 = バスケットアイコン + 品名のシンプル表示（チェック操作は持たない。書き戻し API が無いため）
- `docs/specs/ios-app-screens.md` の HOME セクション一覧に追記

## 影響範囲

- backend: config / types / collectors（新規 1 + all + check）/ llm/briefing の payload 組み立て / runBriefing のログと collector_runs
- iOS: Models + HomeView のみ
- DB スキーマ・API エンドポイント・push は不変（payload_json の中身が増えるだけ）

## テスト方針

- `npm run typecheck`
- `npm run collectors:check` で実 API から未購入品を取得できること
- 一時 DB に shopping 入りの briefing を挿入 → ローカル API サーバ（ポート 8791）→ シミュレータの HOME で「買い物リスト」セクション表示を確認
- 旧 payload（shopping 無し）でセクションが出ないことはオプショナルデコードの型で担保

## 決定記録

- 2026-07-18: ユーザーが API URL を提供して着手指示。この時点の未購入品はコップ洗い・豆腐・ナスの 3 件
