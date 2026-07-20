// HTTP API サーバ。エンドポイントが少ないのでフレームワークは使わず node:http で実装する。
// 認証は経路の用途で分かれる:
//   - iOS アプリ用 API は共有シークレット（Bearer）必須
//   - /admin* は Bearer 認証なし。前段の Cloudflare Access が保護する前提で、
//     ADMIN_ENABLED=on の明示が無い限り 404（fail-safe）。Access のアプリケーション
//     パスは /admin 配下（/admin/* を含む）をカバーしてから有効化すること
//
// iOS アプリ用（Bearer 必須）:
//   POST /devices             — iOS デバイストークン登録 {token, platform?}
//   GET  /briefings/latest    — 最新ブリーフィング JSON（アプリのプル元）
//   GET  /deadlines           — 最新の Canvas 締切 + 手動完了フラグ（アプリの状態同期用）
//   POST /deadlines/complete  — 締切の手動完了チェック {uid, completed}
//   POST /todos/repo          — リポジトリの TODO.md へタスクを追記 {repo, text}
// 管理画面用（Bearer なし・ADMIN_ENABLED=on のときのみ）:
//   GET  /admin               — 管理画面（静的 HTML）
//   GET  /admin/status        — 管理用の状態スナップショット
//   GET  /admin/ai-usage      — AI 利用状況（サマリ + 月別 + 直近の呼び出し）
//   GET  /admin/calendar-info — カレンダータブ用（今日の予定 + 締切と完了状態）
//   GET  /admin/github-info   — GitHub タブ用（リポジトリ一覧 + 昨日の活動。最新ブリーフィング由来）
//   GET  /admin/shopping      — 買い物リスト（共有リスト API をライブ取得）
//   GET/PUT /admin/calendars  — 収集対象カレンダーの一覧・保存
//   GET/PUT /admin/settings   — 収集設定（Canvas 締切の先読み日数）
//   POST /admin/run-briefing  — ブリーフィングジョブの手動実行
//   POST /admin/deadlines/complete — 締切の手動完了チェック（管理画面から。処理は iOS 用と同一）
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_ROOT, config } from './config.js';
import {
  completeDeadline,
  latestBriefing,
  latestCollectorRunRaw,
  listCompletedDeadlineUids,
  uncompleteDeadline,
  upsertDevice,
} from './db/repo.js';
import {
  getAdminSettings,
  getAiUsage,
  getCalendarInfo,
  getGithubInfo,
  getShoppingList,
  getStatus,
  listCalendars,
  runBriefing,
  updateCalendars,
  updateCanvasLookaheadDays,
} from './admin.js';
import { CANVAS_LOOKAHEAD_MAX, CANVAS_LOOKAHEAD_MIN } from './settings.js';
import { RepoTodoError, addRepoTodo } from './githubWrite.js';
import type { BriefingPayload, DeadlineItem } from './types.js';

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

const MAX_CALENDAR_ID_LENGTH = 256; // カレンダー ID はメールアドレス形式。異常値は弾く
const MAX_CALENDARS = 100;

function handleUpdateCalendars(body: string, res: http.ServerResponse): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'JSON がパースできません' });
    return;
  }
  const { ids } = parsed as { ids?: unknown };
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_CALENDARS ||
    !ids.every((v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_CALENDAR_ID_LENGTH)
  ) {
    sendJson(res, 400, { error: 'ids はカレンダー ID 文字列の配列で指定してください' });
    return;
  }
  if (ids.length === 0) {
    // 収集ゼロは誤操作の可能性が高いので保存させない
    sendJson(res, 400, { error: '最低 1 つのカレンダーを選択してください' });
    return;
  }
  updateCalendars(ids);
  sendJson(res, 200, { ok: true, ids });
}

function handleUpdateSettings(body: string, res: http.ServerResponse): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'JSON がパースできません' });
    return;
  }
  const { canvasLookaheadDays } = parsed as { canvasLookaheadDays?: unknown };
  if (
    typeof canvasLookaheadDays !== 'number' ||
    !Number.isInteger(canvasLookaheadDays) ||
    canvasLookaheadDays < CANVAS_LOOKAHEAD_MIN ||
    canvasLookaheadDays > CANVAS_LOOKAHEAD_MAX
  ) {
    sendJson(res, 400, {
      error: `canvasLookaheadDays は ${CANVAS_LOOKAHEAD_MIN}〜${CANVAS_LOOKAHEAD_MAX} の整数で指定してください`,
    });
    return;
  }
  updateCanvasLookaheadDays(canvasLookaheadDays);
  sendJson(res, 200, { ok: true, canvasLookaheadDays });
}

// Canvas の ics UID は event-assignment-<id> 形式。それ以外（calendar 由来等）は対象外
const DEADLINE_UID_PREFIX = 'event-assignment-';
const MAX_UID_LENGTH = 256;

/** 最新の canvas コレクタ実行（status=ok）から締切一覧を取り出す。無ければ空。 */
function latestCanvasDeadlines(): { collectedAt: string | null; deadlines: DeadlineItem[] } {
  const run = latestCollectorRunRaw('canvas');
  if (!run?.raw_json) return { collectedAt: null, deadlines: [] };
  try {
    const deadlines = JSON.parse(run.raw_json) as DeadlineItem[];
    return { collectedAt: run.created_at, deadlines: Array.isArray(deadlines) ? deadlines : [] };
  } catch {
    return { collectedAt: null, deadlines: [] };
  }
}

/** 最新ブリーフィング payload から uid の締切を探す（canvas 収集に無い古い締切のフォールバック）。 */
function briefingPayloadDeadline(uid: string): DeadlineItem | undefined {
  const row = latestBriefing();
  if (!row) return undefined;
  try {
    const payload = JSON.parse(row.payload_json) as BriefingPayload;
    return payload.deadlines.find((d) => d.uid === uid);
  } catch {
    return undefined;
  }
}

function handleListDeadlines(res: http.ServerResponse): void {
  const { collectedAt, deadlines } = latestCanvasDeadlines();
  const completedUids = listCompletedDeadlineUids();
  const completed = new Set(completedUids);
  sendJson(res, 200, {
    collectedAt,
    // アプリの状態同期用。最新収集に含まれない締切（古い payload 表示分）もこれで判定できる
    completedUids,
    deadlines: deadlines.map((d) =>
      d.uid && completed.has(d.uid) ? { ...d, completed: true } : d,
    ),
  });
}

function handleCompleteDeadline(body: string, res: http.ServerResponse): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'JSON がパースできません' });
    return;
  }
  const { uid, completed } = parsed as { uid?: unknown; completed?: unknown };
  if (
    typeof uid !== 'string' ||
    !uid.startsWith(DEADLINE_UID_PREFIX) ||
    uid.length <= DEADLINE_UID_PREFIX.length ||
    uid.length > MAX_UID_LENGTH
  ) {
    sendJson(res, 400, { error: `uid は ${DEADLINE_UID_PREFIX}<id> 形式で指定してください` });
    return;
  }
  if (typeof completed !== 'boolean') {
    sendJson(res, 400, { error: 'completed は true/false で指定してください' });
    return;
  }

  if (!completed) {
    uncompleteDeadline(uid);
    sendJson(res, 200, { ok: true, uid, completed: false });
    return;
  }
  // スナップショット（title / due_at）を最新の canvas 収集 → 最新ブリーフィングの順で探す
  const item =
    latestCanvasDeadlines().deadlines.find((d) => d.uid === uid) ?? briefingPayloadDeadline(uid);
  if (!item) {
    sendJson(res, 404, { error: '指定された uid の締切が見つかりません' });
    return;
  }
  completeDeadline(uid, item.title, item.dueAt);
  sendJson(res, 200, { ok: true, uid, completed: true });
}

// TODO 追記対象のリポジトリ名（owner/name）とタスク 1 行の制限
const REPO_NAME_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_TODO_TEXT_LENGTH = 200;

/**
 * TODO 追記を許可するリポジトリ集合。最新ブリーフィング payload の repos 一覧が正で、
 * 無ければ GITHUB_REPOS の明示 owner/repo エントリ（ローカルパス・`*` は対象外）。
 * トークンで見える任意のリポジトリへ書けないよう対象を限定する（シークレット漏洩時の被害限定）。
 */
function todoWritableRepos(): Set<string> {
  const row = latestBriefing();
  if (row) {
    try {
      const payload = JSON.parse(row.payload_json) as BriefingPayload;
      const repos = new Set((payload.repos ?? []).map((r) => r.repo));
      if (repos.size > 0) return repos;
    } catch {
      // payload が読めなければ GITHUB_REPOS へフォールバック
    }
  }
  return new Set(config.github.repos.filter((e) => REPO_NAME_RE.test(e)));
}

async function handleAddRepoTodo(body: string, res: http.ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'JSON がパースできません' });
    return;
  }
  const { repo, text } = parsed as { repo?: unknown; text?: unknown };
  if (typeof repo !== 'string' || !REPO_NAME_RE.test(repo)) {
    sendJson(res, 400, { error: 'repo は owner/name 形式で指定してください' });
    return;
  }
  if (typeof text !== 'string') {
    sendJson(res, 400, { error: 'text は文字列で指定してください' });
    return;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TODO_TEXT_LENGTH || /[\r\n]/.test(trimmed)) {
    sendJson(res, 400, {
      error: `text は改行なしの 1〜${MAX_TODO_TEXT_LENGTH} 文字で指定してください`,
    });
    return;
  }
  if (!todoWritableRepos().has(repo)) {
    sendJson(res, 400, { error: `対象外のリポジトリです: ${repo}` });
    return;
  }
  try {
    const { url } = await addRepoTodo(repo, trimmed);
    sendJson(res, 200, { ok: true, repo, text: trimmed, url });
  } catch (e) {
    if (e instanceof RepoTodoError) {
      sendJson(res, e.status, { error: e.message });
      return;
    }
    sendJson(res, 502, { error: `TODO の追加に失敗しました: ${(e as Error).message}` });
  }
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
      const path = (req.url ?? '/').split('?')[0] ?? '/';

      // /admin* は ADMIN_ENABLED=on のときだけ存在する。無効時は存在ごと隠す（404）
      if ((path === '/admin' || path.startsWith('/admin/')) && !config.server.adminEnabled) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }

      // /admin* は Bearer 認証なし（前段の Cloudflare Access が保護。上の fail-safe 参照）
      if (path === '/admin' || path === '/admin/') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        serveAdminPage(res);
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

      if (path === '/admin/ai-usage') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        sendJson(res, 200, getAiUsage());
        return;
      }

      if (path === '/admin/calendar-info') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        sendJson(res, 200, getCalendarInfo());
        return;
      }

      if (path === '/admin/github-info') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        sendJson(res, 200, getGithubInfo());
        return;
      }

      if (path === '/admin/shopping') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        try {
          sendJson(res, 200, await getShoppingList());
        } catch (e) {
          // 共有リスト API 側の失敗（未設定・ネットワーク等）は原因を管理画面に出す
          sendJson(res, 502, { error: `買い物リストの取得に失敗: ${(e as Error).message}` });
        }
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

      if (path === '/admin/calendars') {
        if (req.method === 'GET') {
          try {
            sendJson(res, 200, { calendars: await listCalendars() });
          } catch (e) {
            // Google API 側の失敗（未認可・ネットワーク等）は原因を管理画面に出す
            sendJson(res, 502, { error: `カレンダー一覧の取得に失敗: ${(e as Error).message}` });
          }
          return;
        }
        if (req.method === 'PUT') {
          const body = await readBody(req, res);
          if (body !== null) handleUpdateCalendars(body, res);
          return;
        }
        sendJson(res, 405, { error: 'GET または PUT を使ってください' });
        return;
      }

      if (path === '/admin/settings') {
        if (req.method === 'GET') {
          sendJson(res, 200, getAdminSettings());
          return;
        }
        if (req.method === 'PUT') {
          const body = await readBody(req, res);
          if (body !== null) handleUpdateSettings(body, res);
          return;
        }
        sendJson(res, 405, { error: 'GET または PUT を使ってください' });
        return;
      }

      // 管理画面のカレンダーページ用。処理は iOS 用 POST /deadlines/complete と同一
      if (path === '/admin/deadlines/complete') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST を使ってください' });
          return;
        }
        const body = await readBody(req, res);
        if (body !== null) handleCompleteDeadline(body, res);
        return;
      }

      // /admin* で未定義のパスはここで打ち切る（下の Bearer 必須帯に流さない）
      if (path.startsWith('/admin/')) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }

      // これ以降は iOS アプリ用 API。共有シークレット必須
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

      if (path === '/deadlines') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET を使ってください' });
          return;
        }
        handleListDeadlines(res);
        return;
      }

      if (path === '/deadlines/complete') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST を使ってください' });
          return;
        }
        const body = await readBody(req, res);
        if (body !== null) handleCompleteDeadline(body, res);
        return;
      }

      if (path === '/todos/repo') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST を使ってください' });
          return;
        }
        const body = await readBody(req, res);
        if (body !== null) await handleAddRepoTodo(body, res);
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
    console.log(
      config.server.adminEnabled
        ? `  admin: http://localhost:${config.server.port}/admin`
        : '  admin: 無効 (前段の Cloudflare Access 設定後に ADMIN_ENABLED=on で有効化)',
    );
  });
  return server;
}
