# ブリーフィングタイトルの曜日ズレ修正

## 目的・背景

毎朝の push 通知タイトルの曜日が実際の曜日とズレる。

```
7月27日（月）　今日のまとめ  7/27（日）朝ブリーフィング・・・
   ↑ iOS 側（正しい）              ↑ LLM 生成タイトル（曜日が誤り）
```

### 原因

`backend/src/llm/briefing.ts` の SYSTEM_PROMPT が、push タイトルを
「`M/D(曜) 朝ブリーフィング — <トピック>`」という**日付・曜日込みの完成形で LLM に書かせている**。
一方 `buildUserPrompt` が LLM に渡すヘッダは

```
# ブリーフィング日付: 2026-07-27 (America/Los_Angeles)
```

で**曜日を含まない**。予定・締切が 0 件の日は曜日の手がかりが入力に一切無く、
LLM が日付から曜日を暗算して外す（ハルシネーション）。

### 問題ではないと確認した箇所

- `src/util/time.ts` の `briefingDate` / `tzYmd` … `Intl` で America/Los_Angeles ローカル日を取得。正しい。
- iOS `BriefingDate.longDayLabel`（`ios/AISecretary/Models.swift`）… `yyyy-MM-dd` を端末 tz でパースして `M月d日(E)`。正しい。
- `src/jobs/calendarDiff.ts` … 日付のみは UTC 正午扱いで曜日ズレ対策済み。

つまりズレるのは **push タイトル（`briefings.title`）だけ**。

## 対応方針

LLM にはタイトルの日付部分を書かせない。**トピックだけを返させ、
`M/D(曜) 朝ブリーフィング — <トピック>` はコード側で組み立てる**（ハルシネーションの余地を消す）。

1. 構造化出力スキーマの `title` を `topic` に変更する
   - `topic`: 最重要トピックを 20 字程度で。無ければ空文字。
   - `ModelOutput` / `parseModelOutput` も追従。
2. タイトル組み立ての純関数 `buildTitle(date, topic)` を `briefing.ts` に追加
   - 日付部分は `new Date(`${date}T12:00:00Z`).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })`
     → `7/27(月)`。`calendarDiff.ts` と同じ「UTC 正午扱いで曜日の日ズレを防ぐ」方針を踏襲する。
   - `topic` が空なら `7/27(月) 朝ブリーフィング`、あれば `— <topic>` を付ける。
3. 保険として `buildUserPrompt` のヘッダにも曜日を入れる
   - `# ブリーフィング日付: 2026-07-27（月） (America/Los_Angeles)`
   - summary 中で曜日に言及した場合のズレも防ぐ。

## 影響範囲

- `backend/src/llm/briefing.ts` … SYSTEM_PROMPT / OUTPUT_SCHEMA / `ModelOutput` / `parseModelOutput` /
  `generateBriefing` / `buildUserPrompt`、`buildTitle` 追加
- 呼び出し側（`src/jobs/runBriefing.ts`, `src/llm/check.ts`）は `GeneratedBriefing.title` を
  そのまま使い続けるので**変更不要**
- DB スキーマ・API・payload・iOS は変更なし（`briefings.title` の中身が正しくなるだけ）

## テスト方針

- `npm run typecheck`
- `buildTitle` の純関数検証（曜日が既知の複数日付・topic 空/非空）
  → 既存の `*:check` にならい、簡易チェックスクリプトか tsx ワンライナーで確認
- `npm run llm:check -- --fixture` で実際に生成し、タイトルの曜日が当日と一致することを確認
