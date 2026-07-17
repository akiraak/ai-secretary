# iOS 実機ビルドスクリプト（接続先の自動注入 + --prod 切替）

## 目的・背景

現状、iOS アプリの接続先（バックエンド URL / 共有シークレット）は実機の Setting タブで手入力する必要がある。
ビルド & インストール時に Mac の LAN アドレスを既定値として焼き込み、`--prod` フラグで本番（g3plus）向けに
切り替えられるようにして、実機セットアップを手入力なしにする。

esl-learning-assistant の `run-ios-device.sh` と同じ方式を採用する（プロジェクト間で流儀を揃える）。

## 対応方針

1. **project.yml**: ビルド設定 `BACKEND_BASE_URL`（既定 `http://g3plus.local:8787`）/ `BACKEND_API_SECRET`（既定 空）を追加し、
   Info.plist に `BackendBaseURL: $(BACKEND_BASE_URL)` / `BackendAPISecret: $(BACKEND_API_SECRET)` として埋め込む
2. **AppState.swift**: UserDefaults に保存値が無い（または空の）ときは Info.plist の焼き込み値を既定として使う。
   ユーザーが Setting タブで編集したら以後は保存値が優先（didSet は init では発火しないため、
   未編集ならリビルドで新しい焼き込み値に追従する）
3. **run-ios-device.sh**（リポジトリ直下、esl と同名・同 UX）:
   - `--local`（既定）= Mac の LAN IP を `ipconfig getifaddr` で自動検出して `http://<IP>:8787`
   - `--prod` = `http://g3plus.local:8787`
   - シークレットは `backend/.env` の `API_SHARED_SECRET` を注入（`BACKEND_API_SECRET` 環境変数で上書き可）
   - デバイスは `xcrun devicectl` で自動検出（複数台なら `DEVICE_ID` で指定）→ ビルド → インストール → 起動
   - `project.yml` が `.xcodeproj` より新しければ `xcodegen generate` を自動実行

## 影響範囲

- `ios/project.yml`（ビルド設定 + Info.plist キー追加）→ 要 `xcodegen generate`
- `ios/AISecretary/AppState.swift`（既定値の解決ロジックのみ。保存済みの値がある端末の挙動は不変）
- `run-ios-device.sh`（新規）
- `CLAUDE.md` のビルドコマンド節に 1 行追記

## テスト方針

- `xcodegen generate` → シミュレータビルドが通ること（`CODE_SIGNING_ALLOWED=NO`）
- `bash -n run-ios-device.sh` で構文確認
- 実機で `./run-ios-device.sh` を実行し、Setting タブに Mac の IP が既定表示されること
- `--prod` 指定時に `http://g3plus.local:8787` が焼き込まれること（ビルドログの設定値で確認）
