# g3plus デプロイ手順（API サーバ常駐 + cron 07:00 PT）

作成日: 2026-07-15
親プラン: [MVP: 朝ブリーフィングを iOS アプリに push](../plans/mvp-morning-briefing.md)（Step 8）

g3plus（Ubuntu）に backend を配置し、

- **API サーバ**（`npm start`）を systemd で常駐させる
- **briefing ジョブ**（収集 → LLM 生成 → 保存 → APNs push）を cron で毎朝 07:00 PT に実行する

ための手順。関連ファイルは `backend/scripts/cron-briefing.sh` /
`backend/deploy/crontab.example` / `backend/deploy/ai-secretary-api.service`。

## 前提

- Node **>= 22**（`node -v` で確認。無ければ nvm 等で導入 — ラッパスクリプトは nvm を自動で読む）
- このリポジトリを g3plus に clone 済み（以下 `~/ai-secretary` と仮定。実際のパスに読み替える）
- `.env` 一式が揃っていること（TODO.md の「ユーザー作業」参照）:
  Google OAuth / Canvas iCal URL / GITHUB_TOKEN / ANTHROPIC_API_KEY / APNS_* / API_SHARED_SECRET。
  Mac で検証済みの `.env` と `.p8` をそのまま持ち込むのが早い（どちらも git 管理外なので scp 等で）
- 管理画面 `/admin` は **`ADMIN_ENABLED=on` の明示があるときだけ存在する**（無ければ `/admin*` は全て 404 = fail-safe）。
  本番では前段（Cloudflare Access 等）で `/admin` を認証保護してから on にする

## 1. セットアップ

```bash
cd ~/ai-secretary/backend
npm ci
cp /path/to/.env .env          # 検証済みの .env を配置（APNS_P8_PATH のパスを g3plus 上の場所に直す）
npm run collectors:check       # 実データが取れることを確認
npm run llm:check -- --fixture # LLM 疎通確認
```

DB（SQLite）は初回アクセス時に `backend/data/ai-secretary.db` へ自動作成される（`DB_PATH` で変更可）。

## 2. API サーバを常駐させる（systemd）

```bash
# unit 内の User / パス / npm の絶対パス（command -v npm）を書き換えてから
sudo cp deploy/ai-secretary-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-secretary-api
journalctl -u ai-secretary-api -f    # 起動ログ確認
```

動作確認（8787 は `.env` の PORT）:

```bash
curl -i http://localhost:8787/briefings/latest \
  -H "Authorization: Bearer $API_SHARED_SECRET"   # 生成前は 404、生成後は 200
```

- iOS アプリからは公開 URL **`https://secretary.chobi.me`**（Cloudflare 経由で g3plus の 8787 へ）で到達させる
- `./run-ios-device.sh --prod` が接続先 URL と共有シークレットをアプリに焼き込むため、
  iOS の Setting タブでの手入力は不要（手動で上書きも可）

## 3. cron 登録（毎朝 07:00 PT）

`crontab -e` で `backend/deploy/crontab.example` の内容を追記する（パスを書き換え）:

```cron
CRON_TZ=America/Los_Angeles
MAILTO=""
0 7 * * * /home/akiraak/ai-secretary/backend/scripts/cron-briefing.sh
```

- `CRON_TZ` で PT 固定なので DST 切り替えも自動で追従する（Ubuntu 23.04+ の cron が対応）
- 実行時刻は `.env` の `BRIEFING_HOUR` と合わせておく
- ラッパスクリプトの挙動: ログを `backend/logs/briefing-<日時>.log` に保存（30 日で自動削除、
  `BRIEFING_LOG_KEEP_DAYS` で変更可）、flock で多重起動防止、失敗時はログ末尾を stderr に出す
  （`MAILTO` を設定していればメール通知になる）

### CRON_TZ が使えない場合の代替（systemd timer）

古い cron の場合は timer で置き換える（`OnCalendar` がタイムゾーンを直接解釈する）:

```ini
# /etc/systemd/system/ai-secretary-briefing.service
[Unit]
Description=AI Secretary morning briefing job
[Service]
Type=oneshot
User=akiraak
ExecStart=/home/akiraak/ai-secretary/backend/scripts/cron-briefing.sh

# /etc/systemd/system/ai-secretary-briefing.timer
[Unit]
Description=Run morning briefing at 07:00 PT
[Timer]
OnCalendar=*-*-* 07:00:00 America/Los_Angeles
Persistent=false
[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ai-secretary-briefing.timer
```

## 4. エンドツーエンド確認

1. iOS 実機にアプリをインストールし、通知許可 → Setting タブでデバイス登録済みを確認
2. g3plus で手動実行: `~/ai-secretary/backend/scripts/cron-briefing.sh; echo "exit=$?"`
3. `backend/logs/` の最新ログで 収集件数 → 保存 → `push: 送信 1 / 失敗 0` を確認
4. iOS 実機に通知が届き、タップで HOME に日本語ブリーフィングが表示されることを確認
5. 翌朝 07:00 PT に cron からも届くことを確認（ログのタイムスタンプで判定）

## 障害時の調べ方

- **exit code**: 0 以外なら失敗。127=npm 不在、1=コレクタ/LLM/push の失敗（ログ参照）
- **ログ**: `backend/logs/briefing-*.log`（コレクタ警告 `⚠ [名前] ...` は該当ソースが空で続行した印）
- **DB**: `collector_runs`（ソース別 ok/error）、`push_log`（APNs ステータス）、
  `briefings.pushed_at`（push 成功済みか）を `sqlite3 backend/data/ai-secretary.db` で確認
- **push が全滅**: ジョブは exit 1 になる。APNS_ENV（sandbox=Xcode 直インストール /
  production=TestFlight）とビルド種別の不一致、410 でデバイス削除済み → アプリ再起動で再登録
