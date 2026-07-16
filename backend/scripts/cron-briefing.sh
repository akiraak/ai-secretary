#!/usr/bin/env bash
# cron から毎朝の briefing ジョブ（npm run briefing）を実行するラッパ。
# crontab 例は ../deploy/crontab.example、デプロイ手順は docs/specs/deploy-g3plus.md を参照。
#
# - cron の最小 PATH でも node/npm を解決する（nvm → fnm default → よくある配置の順）
# - 出力を backend/logs/briefing-<日時>.log に保存し、古いログを自動削除
# - flock がある環境（Linux）では多重起動を防止
# - 失敗時は exit code を維持し、ログ末尾を stderr へ出す（cron の MAILTO 通知用）
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$BACKEND_DIR/logs"
KEEP_DAYS="${BRIEFING_LOG_KEEP_DAYS:-30}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/briefing-$(date +%Y%m%d-%H%M%S).log"

# cron の PATH は最小（/usr/bin:/bin 程度）なので npm を自力で解決する
if ! command -v npm >/dev/null 2>&1 && [ -s "${HOME:-}/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi
if ! command -v npm >/dev/null 2>&1; then
  for dir in \
    "${HOME:-}/.local/share/fnm/aliases/default/bin" \
    "${HOME:-}/Library/Application Support/fnm/aliases/default/bin" \
    /usr/local/bin /opt/homebrew/bin /opt/node/bin; do
    if [ -x "$dir/npm" ]; then
      PATH="$dir:$PATH"
      break
    fi
  done
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm が見つかりません (PATH=$PATH)" | tee -a "$LOG_FILE" >&2
  exit 127
fi

# 多重起動防止（flock は Linux 標準。macOS には無いのでその場合はスキップ）
exec 9>>"$LOG_DIR/.briefing.lock"
if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
  echo "前回の briefing ジョブが実行中のためスキップ: $(date '+%Y-%m-%dT%H:%M:%S%z')" >>"$LOG_FILE"
  exit 0
fi

cd "$BACKEND_DIR" || exit 1
{
  echo "=== cron-briefing $(date '+%Y-%m-%dT%H:%M:%S%z') node=$(node -v) ==="
  npm run --silent briefing
} >>"$LOG_FILE" 2>&1
STATUS=$?

find "$LOG_DIR" -name 'briefing-*.log' -mtime +"$KEEP_DAYS" -delete 2>/dev/null

if [ "$STATUS" -ne 0 ]; then
  {
    echo "briefing 失敗 (exit=$STATUS) — ログ: $LOG_FILE"
    tail -n 20 "$LOG_FILE"
  } >&2
fi
exit "$STATUS"
