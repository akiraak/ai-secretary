#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/ios"

SCHEME="AISecretary"
PROJECT="AISecretary.xcodeproj"
BUNDLE_ID="com.akiraak.ai-secretary"
PROD_BASE_URL="http://g3plus.local:8787"
LOCAL_PORT="8787"

usage() {
  cat <<'USAGE'
Usage: run-ios-device.sh [--local|--prod]

  --local  ローカル backend に接続するビルド（デフォルト）。
           Mac の LAN IP を自動検出して http://<IP>:8787 を焼き込む
  --prod   本番サーバ (http://g3plus.local:8787) に接続するビルド

いずれも backend/.env の API_SHARED_SECRET を注入する（g3plus にも同じ値を配置する前提）。
環境変数 DEVICE_ID / BACKEND_BASE_URL / BACKEND_API_SECRET で個別に上書きできる。
USAGE
}

TARGET="local"
for arg in "$@"; do
  case "$arg" in
    --local) TARGET="local" ;;
    --prod|--production) TARGET="prod" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[run-ios-device] 不明なオプション: $arg" >&2; usage >&2; exit 1 ;;
  esac
done
echo "[run-ios-device] 接続先: $TARGET"

# .xcodeproj は生成物。無い or project.yml の方が新しいときは再生成する
if [ ! -d "$PROJECT" ] || [ project.yml -nt "$PROJECT/project.pbxproj" ]; then
  echo "[run-ios-device] xcodegen generate を実行します..."
  xcodegen generate
fi

# デバイス ID は DEVICE_ID 環境変数で上書き可能。未指定ならペアリング済みデバイスを自動検出する
if [ -z "${DEVICE_ID:-}" ]; then
  DEVICES_JSON="$(mktemp -t devicectl-devices)"
  trap 'rm -f "$DEVICES_JSON"' EXIT
  xcrun devicectl list devices -j "$DEVICES_JSON" >/dev/null
  device_count="$(jq '.result.devices | length' "$DEVICES_JSON")"
  if [ "$device_count" -eq 0 ]; then
    echo "[run-ios-device] ペアリング済みデバイスが見つかりません。USB で一度接続してペアリングしてください。" >&2
    exit 1
  fi
  if [ "$device_count" -gt 1 ]; then
    echo "[run-ios-device] デバイスが複数見つかりました。DEVICE_ID 環境変数で指定してください:" >&2
    jq -r '.result.devices[] | "\(.hardwareProperties.udid)\t\(.deviceProperties.name)"' "$DEVICES_JSON" >&2
    exit 1
  fi
  # xcodebuild の -destination id= は CoreDevice の identifier ではなく UDID を要求する
  DEVICE_ID="$(jq -r '.result.devices[0].hardwareProperties.udid' "$DEVICES_JSON")"
fi

# バックエンド URL は BACKEND_BASE_URL 環境変数で上書き可能。
# 未指定なら --prod は本番サーバ、--local(デフォルト) は Mac の LAN IP を自動検出して使う
if [ -z "${BACKEND_BASE_URL:-}" ]; then
  if [ "$TARGET" = "prod" ]; then
    BACKEND_BASE_URL="$PROD_BASE_URL"
    echo "[run-ios-device] BACKEND_BASE_URL=${BACKEND_BASE_URL}（本番サーバ）"
  else
    MAC_IP=""
    for iface in en0 en1 en2; do
      MAC_IP="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      [ -n "$MAC_IP" ] && break
    done
    if [ -n "$MAC_IP" ]; then
      BACKEND_BASE_URL="http://${MAC_IP}:${LOCAL_PORT}"
      echo "[run-ios-device] BACKEND_BASE_URL=${BACKEND_BASE_URL}（Mac の LAN IP を自動検出）"
    else
      BACKEND_BASE_URL="http://localhost:${LOCAL_PORT}"
      echo "[run-ios-device] Mac の LAN IP を自動検出できませんでした。アプリの Setting タブで URL を手動設定してください。" >&2
    fi
  fi
fi

# API 共有シークレット。BACKEND_API_SECRET 環境変数で上書き可能。
# 未指定なら backend/.env の API_SHARED_SECRET を読む（本番 g3plus も同じ値を配置する前提）
if [ -z "${BACKEND_API_SECRET:-}" ]; then
  SECRET_FILE="$SCRIPT_DIR/backend/.env"
  if [ -f "$SECRET_FILE" ]; then
    BACKEND_API_SECRET="$(grep -E '^API_SHARED_SECRET=' "$SECRET_FILE" | head -n 1 | cut -d= -f2-)"
    if [ -n "$BACKEND_API_SECRET" ]; then
      echo "[run-ios-device] API 共有シークレットを backend/.env から注入します"
    fi
  fi
fi
if [ -z "${BACKEND_API_SECRET:-}" ]; then
  echo "[run-ios-device] API 共有シークレットが未指定です。backend/.env の API_SHARED_SECRET を設定するか、アプリの Setting タブで入力してください。" >&2
fi

echo "[run-ios-device] DEVICE_ID=$DEVICE_ID でビルドします..."
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -destination "id=$DEVICE_ID" \
  -derivedDataPath DerivedData -allowProvisioningUpdates \
  BACKEND_BASE_URL="$BACKEND_BASE_URL" BACKEND_API_SECRET="${BACKEND_API_SECRET:-}" build

APP_PATH="DerivedData/Build/Products/Debug-iphoneos/${SCHEME}.app"
if [ ! -d "$APP_PATH" ]; then
  echo "[run-ios-device] ビルド済みの ${SCHEME}.app が見つかりませんでした。" >&2
  exit 1
fi
echo "[run-ios-device] APP_PATH=$APP_PATH"

echo "[run-ios-device] デバイスへインストールします..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"

echo "[run-ios-device] アプリを起動します..."
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"

echo "[run-ios-device] 完了しました。"
