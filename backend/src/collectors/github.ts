// GitHub コレクタ: 昨日（シアトル時間）の commits / PR 活動を取得する。
// データ源は Events API（PushEvent / PullRequestEvent）。単一ユーザーの直近活動を
// リポジトリ横断で 1 系統から拾えるため、リポジトリごとの API 呼び出しをしない。
// 認証: GITHUB_TOKEN があればそれを使い、無ければ gh CLI（`gh auth token`）から借りる。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { tzLocalToInstant, tzYmd } from '../util/time.js';
import type { GithubItem } from '../types.js';

const execFileAsync = promisify(execFile);

const API_BASE = 'https://api.github.com';
// Events API は 100 件/頁。昨日 1 日分なら 3 頁（300 イベント）で十分
const MAX_EVENT_PAGES = 3;

/** GITHUB_TOKEN → gh CLI の順でアクセストークンを解決する。 */
export async function resolveToken(): Promise<string> {
  if (config.github.token) return config.github.token;
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // gh 未インストール / 未ログインはまとめて下のエラーで案内する
  }
  throw new Error(
    'GitHub のトークンがありません。.env に GITHUB_TOKEN を設定するか、gh CLI で `gh auth login` してください。',
  );
}

function headers(token: string, accept: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** GitHub REST API を叩いて JSON を返す。 */
export async function ghApi<T>(apiPath: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    headers: headers(token, 'application/vnd.github+json'),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${apiPath} が失敗しました: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** GitHub REST API を raw Accept で叩いてテキストを返す（contents 取得用）。 */
export async function ghApiRaw(apiPath: string, token: string): Promise<string> {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    headers: headers(token, 'application/vnd.github.raw'),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${apiPath} が失敗しました: HTTP ${res.status}`);
  }
  return res.text();
}

/** Events API のレスポンスのうち使う部分だけの型。 */
export interface GhEvent {
  type: string;
  created_at: string;
  repo: { name: string };
  payload: {
    action?: string;
    commits?: { sha: string; message: string; distinct?: boolean }[];
    pull_request?: { title: string; html_url: string; merged?: boolean };
  };
}

/** 昨日（tz ローカル）の範囲 [start, end) を返す。 */
function yesterdayWindow(now: Date, tz: string): { start: Date; end: Date } {
  const { year, month, day } = tzYmd(now, tz);
  return {
    start: tzLocalToInstant(year, month, day - 1, 0, tz),
    end: tzLocalToInstant(year, month, day, 0, tz),
  };
}

/** now を基準に、昨日(tz)の commits / PR 活動を取得する。 */
export async function collectGithub(now: Date = new Date()): Promise<GithubItem[]> {
  const token = await resolveToken();
  const { login } = await ghApi<{ login: string }>('/user', token);
  const { start } = yesterdayWindow(now, config.briefing.tz);

  const events: GhEvent[] = [];
  for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
    const batch = await ghApi<GhEvent[]>(`/users/${login}/events?per_page=100&page=${page}`, token);
    events.push(...batch);
    if (batch.length < 100) break;
    // 頁末尾（最古）のイベントが窓より前なら、それ以降の頁は見なくてよい
    const oldest = batch[batch.length - 1]!;
    if (new Date(oldest.created_at) < start) break;
  }
  return extractGithubItems(events, now);
}

/** イベント配列から昨日分の GithubItem を抽出する部分（フェッチと分離しテスト可能にする）。 */
export function extractGithubItems(events: GhEvent[], now: Date): GithubItem[] {
  const { start, end } = yesterdayWindow(now, config.briefing.tz);

  const items: GithubItem[] = [];
  const seenCommits = new Set<string>();
  const seenPrs = new Set<string>();
  // Events API は新しい順なので、古い順（時系列）に直して読む
  for (const ev of [...events].reverse()) {
    const t = new Date(ev.created_at);
    if (t < start || t >= end) continue;

    if (ev.type === 'PushEvent') {
      for (const c of ev.payload.commits ?? []) {
        // distinct=false は他の push で既に配信済みの commit（force-push 等の重複）
        if (c.distinct === false || seenCommits.has(c.sha)) continue;
        seenCommits.add(c.sha);
        items.push({
          repo: ev.repo.name,
          kind: 'commit',
          title: c.message.split('\n', 1)[0]!,
          url: `https://github.com/${ev.repo.name}/commit/${c.sha}`,
        });
      }
    } else if (ev.type === 'PullRequestEvent') {
      const pr = ev.payload.pull_request;
      if (!pr) continue;
      const action = ev.payload.action;
      const label =
        action === 'opened'
          ? '作成'
          : action === 'reopened'
            ? '再オープン'
            : action === 'closed'
              ? pr.merged
                ? 'マージ'
                : 'クローズ'
              : null;
      if (!label) continue; // synchronize / labeled 等はノイズなので拾わない
      const key = `${pr.html_url}#${label}`;
      if (seenPrs.has(key)) continue;
      seenPrs.add(key);
      items.push({
        repo: ev.repo.name,
        kind: 'pr',
        title: `PR ${label}: ${pr.title}`,
        url: pr.html_url,
      });
    }
  }
  return items;
}
