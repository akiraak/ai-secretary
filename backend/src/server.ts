// HTTP API サーバ。単一ユーザーなので認証は共有シークレット（Bearer）で簡易に行う。
// エンドポイントが少ないのでフレームワークは使わず node:http で実装する。
//   POST /devices             — iOS デバイストークン登録 {token, platform?}
//   GET  /briefings/latest    — 最新ブリーフィング JSON（アプリのプル元）
//   GET  /admin               — 管理画面（静的 HTML。データを含まないため認証なし）
//   GET  /admin/status        — 管理用の状態スナップショット
//   POST /admin/run-briefing  — ブリーフィングジョブの手動実行
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_ROOT, config } from './config.js';
import { latestBriefing, upsertDevice } from './db/repo.js';
import { getStatus, runBriefing } from './admin.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 512; // APNs トークンは hex 64 文字程度。異常値は弾く

/** Authorization ヘッダの Bearer トークンを共有シークレットと定数時間で比較する。 */
export function authorized(header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

/** リクエストボディを上限付きで読み取る。超過時は null を返し 413 を送る。 */
async function readBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: 'リクエストボディが大きすぎます' });
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function handleRegisterDevice(body: string, res: http.ServerResponse): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'JSON がパースできません' });
    return;
  }
  const { token, platform } = parsed as { token?: unknown; platform?: unknown };
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    sendJson(res, 400, { error: 'token は 1〜512 文字の文字列で指定してください' });
    return;
  }
  if (platform !== undefined && (typeof platform !== 'string' || platform.length > 32)) {
    sendJson(res, 400, { error: 'platform は 32 文字以内の文字列で指定してください' });
    return;
  }
  const device = upsertDevice(token, platform ?? 'ios');
  sendJson(res, 200, { ok: true, id: device.id });
}

const ADMIN_HTML_PATH = path.join(BACKEND_ROOT, 'assets', 'admin.html');

function serveAdminPage(res: http.ServerResponse): void {
  const html = fs.readFileSync(ADMIN_HTML_PATH);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
  });
  res.end(html);
}

function handleLatestBriefing(res: http.ServerResponse): void {
  const row = latestBriefing();
  if (!row) {
    sendJson(res, 404, { error: 'まだブリーフィングがありません' });
    return;
  }
  sendJson(res, 200, {
    id: row.id,
    date: row.briefing_date,
    lang: row.lang,
    title: row.title,
    summary: row.summary,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at,
    pushedAt: row.pushed_at,
  });
}

/** ルーティング本体（listen はしない。テスト時は任意ポートで listen できる）。 */
export function createServer(secret: string): http.Server {
  return http.createServer(async (req, res) => {
    res.on('finish', () => {
      console.log(`${req.method} ${req.url} -> ${res.statusCode}`);
    });
    try {
      const path = (req.url ?? '/').split('?')[0];

      // 管理画面の静的ページのみ認証なし（シークレット入力用の器で、データは status 側が守る）
      if (path === '/admin' || path === '/admin/') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        serveAdminPage(res);
        return;
      }

      if (!authorized(req.headers.authorization, secret)) {
        sendJson(res, 401, { error: '認証に失敗しました (Bearer API_SHARED_SECRET)' });
        return;
      }

      if (path === '/devices') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST を使ってください' });
          return;
        }
        const body = await readBody(req, res);
        if (body !== null) handleRegisterDevice(body, res);
        return;
      }

      if (path === '/briefings/latest') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        handleLatestBriefing(res);
        return;
      }

      if (path === '/admin/status') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        sendJson(res, 200, getStatus());
        return;
      }

      if (path === '/admin/run-briefing') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST を使ってください' });
          return;
        }
        if (runBriefing()) {
          sendJson(res, 202, { ok: true, message: 'briefing ジョブを起動しました' });
        } else {
          sendJson(res, 409, { error: 'briefing ジョブは既に実行中です' });
        }
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      console.error(`リクエスト処理エラー: ${(e as Error).stack ?? e}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    }
  });
}

/** 設定を検証して API サーバを起動する。 */
export function startServer(): http.Server {
  const secret = config.server.sharedSecret;
  if (!secret) {
    throw new Error('API_SHARED_SECRET が未設定です。.env に設定してください。');
  }
  const server = createServer(secret);
  server.listen(config.server.port, () => {
    console.log(`ai-secretary API サーバ起動: http://localhost:${config.server.port}`);
    console.log(`  DB: ${config.db.path}`);
  });
  return server;
}
