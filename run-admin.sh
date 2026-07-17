#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ポートの決定: PORT 環境変数 > backend/.env の PORT > 8787
if [ -z "${PORT:-}" ]; then
  PORT="$(grep -E '^PORT=' backend/.env 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
fi
PORT="${PORT:-8787}"

# 既存プロセスがポートを掴んでいれば停止してから起動する
PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  echo "port ${PORT} を使用中のプロセス (${PIDS}) を停止します"
  kill $PIDS 2>/dev/null || true
  sleep 1
  PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

# 起動後にブラウザで管理画面を開く（macOS。open が無い環境ではスキップ）
if command -v open >/dev/null 2>&1; then
  ( sleep 1.5; open "http://localhost:${PORT}/admin" ) &
fi

cd backend
exec npm start
