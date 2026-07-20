# 管理画面の認証を Cloudflare Access に一本化（共有シークレット入力を廃止）

作成日: 2026-07-19

## 目的・背景

管理画面（`/admin`）は現在、静的 HTML 自体は認証なしで配信しつつ、データ API（`/admin/*`）は
iOS アプリと同じ Bearer 共有シークレットで守っている。ブラウザ側は localStorage に保存した
シークレットを Authorization ヘッダに載せる方式のため、**PC・ブラウザごとにシークレットの
手入力が必要**で、未入力だと空画面になる（実際に別 PC で発生）。

本番の `https://secretary.chobi.me/admin` にはすでに **Cloudflare Access の認証が前段に入っている**
ため、管理画面に関しては認証を Cloudflare Access に一本化し、共有シークレットの入力を不要にする。

## 対応方針

認証の境界を「エンドポイントの用途」で分ける。

| 経路 | 認証 |
|---|---|
| `/admin`（静的 HTML）・`/admin/*`（データ API） | **Bearer 認証なし**。前段の Cloudflare Access が保護。`ADMIN_ENABLED=on` の明示が無い限り 404（fail-safe、従来どおり） |
| `/devices` `/briefings/latest` `/deadlines` `/deadlines/complete`（iOS アプリ用） | **Bearer 共有シークレット必須**（従来どおり。アプリは Cloudflare Access を通らない） |

### Step 1: backend (`src/server.ts`)

- ルーティングを並べ替え、`/admin*` 系をすべて `authorized()` チェックの**前**に移動する
- 管理画面のカレンダーページが使う締切完了チェックのため **`POST /admin/deadlines/complete`** を新設
  （既存 `handleCompleteDeadline` を共用。iOS 用の `POST /deadlines/complete` は Bearer 必須のまま残す）
- ファイル冒頭コメントの認証説明を更新

### Step 2: 管理画面 (`assets/admin.html`)

- サイドバー下部のシークレット入力欄・「保存して読み込み」ボタン・authMsg を撤去
- `secret()` / localStorage / Authorization ヘッダを撤去（過去の `adminSecret` は読み込み時に削除して掃除）
- ページを開いたら無条件で `refresh()`、ページ切り替え時も無条件で各ページの読み込みを実行
- 締切完了チェックの呼び先を `/deadlines/complete` → `/admin/deadlines/complete` に変更
- `api()` の 401 特別扱いを削除。代わりに **200 なのに JSON でない応答**（Cloudflare Access の
  セッション切れでログインページ HTML が返るケース）を検知して「リロードしてください」を表示

### Step 3: ドキュメント（`docs/specs/deploy-g3plus.md`）

- 管理画面の認証は Cloudflare Access のみになる旨を明記
- Access のアプリケーションパスが `/admin` 配下（`/admin/*` を含むプレフィックス）を
  カバーしていることを有効化の前提条件として強調

## 影響範囲

- `backend/src/server.ts` と `backend/assets/admin.html` のみ。DB・コレクタ・LLM・push・iOS は不変
- iOS アプリ用 API の認証は不変（アプリ側の変更なし）
- **セキュリティ上のトレードオフ**: origin（g3plus:8787）へ Cloudflare を経由せず直接到達できる
  ネットワーク上の相手には、`/admin/*` が無認証で見える（従来はシークレットが必要だった）。
  前提は「外部からは Cloudflare 経由でしか届かない」こと。LAN 内も守りたくなったら
  Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion`）検証を backend に足すのが次の一手（今回はやらない）

## テスト方針

- `npm run typecheck`
- admin.html の `<script>` 部を抽出して `node --check`
- ローカルで API サーバを起動（`ADMIN_ENABLED=on`）し curl で認証境界を確認:
  - `GET /admin/status` 認証なし → 200
  - `POST /admin/deadlines/complete` 認証なし → 400（バリデーションまで到達 = 認証は通過）
  - `GET /briefings/latest` 認証なし → 401 / Bearer あり → 200 or 404
  - `POST /deadlines/complete` 認証なし → 401
  - `ADMIN_ENABLED` 未設定で `/admin/status` → 404（fail-safe 維持）
- headless Chrome で `/admin` を開き、シークレット入力なしで全ページにデータが読み込まれ
  JS エラーが無いことを確認
