// GitHub コレクタ: 昨日（シアトル時間）の commits / PR 活動を取得する。
// データ源は Events API（PushEvent / PullRequestEvent）。単一ユーザーの直近活動を
// リポジトリ横断で 1 系統から拾えるため、リポジトリごとの API 呼び出しをしない。
// 認証: GITHUB_TOKEN があればそれを使い、無ければ gh CLI（`gh auth token`）から借りる。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { tzLocalToInstant, tzYmd } from '../util/time.js';
import type { GithubItem, RepoCommit, RepoOverview } from '../types.js';

const execFileAsync = promisify(execFile);

const API_BASE = 'https://api.github.com';
// Events API は 100 件/頁。昨日 1 日分なら 3 頁（300 イベント）で十分
const MAX_EVENT_PAGES = 3;
// /user/repos のページング上限（100 件/頁 × 10 = 1000 リポジトリまで）
const MAX_REPO_PAGES = 10;
// リポジトリ一覧（GitHub タブ）の対象: 直近 90 日以内に push があったもの、最大 20 件
const REPO_OVERVIEW_MAX_AGE_DAYS = 90;
const REPO_OVERVIEW_MAX_REPOS = 20;
// 詳細画面用に各リポジトリから取る直近コミット数
const REPO_OVERVIEW_COMMITS_PER_REPO = 10;
// commits 取得（最大 20 リポジトリ分）の並列数
const COMMITS_FETCH_CONCURRENCY = 8;

/** GitHub API の HTTP エラー。呼び出し側が 404（TODO.md 無し等）を区別できるよう status を持つ。 */
export class GhHttpError extends Error {
  constructor(
    apiPath: string,
    readonly status: number,
  ) {
    super(`GitHub API ${apiPath} が失敗しました: HTTP ${status}`);
  }
}

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
    throw new GhHttpError(apiPath, res.status);
  }
  return (await res.json()) as T;
}

/** GitHub REST API を raw Accept で叩いてテキストを返す（contents 取得用）。 */
export async function ghApiRaw(apiPath: string, token: string): Promise<string> {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    headers: headers(token, 'application/vnd.github.raw'),
  });
  if (!res.ok) {
    throw new GhHttpError(apiPath, res.status);
  }
  return res.text();
}

/** /user/repos のレスポンスのうち使う部分だけの型。 */
interface GhRepo {
  full_name: string;
  fork: boolean;
  archived: boolean;
  html_url: string;
  pushed_at: string | null; // push が一度も無いリポジトリは null
}

/**
 * トークンで見える全リポジトリ（own / collaborator / org）を pushed 降順で列挙する。
 * fork（upstream 由来の TODO.md がノイズになる）と archived（停止済み）は除外。
 * 監視したい fork は GITHUB_REPOS に明示指定すれば読める。
 */
async function listActiveRepos(token: string): Promise<GhRepo[]> {
  const repos: GhRepo[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const batch = await ghApi<GhRepo[]>(
      `/user/repos?per_page=100&sort=pushed&direction=desc&page=${page}`,
      token,
    );
    for (const r of batch) {
      if (!r.fork && !r.archived) repos.push(r);
    }
    if (batch.length < 100) break;
  }
  return repos;
}

/** トークンで見えるリポジトリ（fork / archived 除く）を `owner/repo` で列挙する。 */
export async function listAccessibleRepos(token: string): Promise<string[]> {
  return (await listActiveRepos(token)).map((r) => r.full_name);
}

/** commits API のレスポンスのうち使う部分だけの型。 */
interface GhCommit {
  html_url: string;
  commit: {
    message: string;
    author?: { date?: string } | null;
    committer?: { date?: string } | null;
  };
}

/** 1 リポジトリの直近コミットを取得する。空リポジトリ（HTTP 409）は正常扱いで空を返す。 */
async function fetchRecentCommits(fullName: string, token: string): Promise<RepoCommit[]> {
  let commits: GhCommit[];
  try {
    commits = await ghApi<GhCommit[]>(
      `/repos/${fullName}/commits?per_page=${REPO_OVERVIEW_COMMITS_PER_REPO}`,
      token,
    );
  } catch (e) {
    if (e instanceof GhHttpError && e.status === 409) return [];
    throw e;
  }
  return commits.map((c) => ({
    message: c.commit.message.split('\n', 1)[0]!,
    date: c.commit.committer?.date ?? c.commit.author?.date ?? '',
    url: c.html_url,
  }));
}

/**
 * GitHub タブ用の更新順リポジトリ一覧を収集する。
 * 対象は非 fork・非 archived のうち直近 90 日以内に push があったもの（pushed_at 降順、最大 20 件）。
 * todo 系フィールド（todoRepo / todoSummary / todoCount）と recentSummary は
 * runBriefing 側で join / LLM 生成して埋める。
 */
export async function collectRepoOverviews(now: Date = new Date()): Promise<RepoOverview[]> {
  const token = await resolveToken();
  const cutoff = new Date(now.getTime() - REPO_OVERVIEW_MAX_AGE_DAYS * 86_400_000);
  const targets = (await listActiveRepos(token))
    .filter((r) => r.pushed_at !== null && new Date(r.pushed_at) >= cutoff)
    .slice(0, REPO_OVERVIEW_MAX_REPOS);

  // 並列プール（結果は targets の順 = pushed_at 降順を保つ）
  const overviews: RepoOverview[] = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      const r = targets[i]!;
      overviews[i] = {
        repo: r.full_name,
        url: r.html_url,
        pushedAt: r.pushed_at!,
        commits: await fetchRecentCommits(r.full_name, token),
        todoCount: 0,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(COMMITS_FETCH_CONCURRENCY, targets.length) }, worker),
  );
  return overviews;
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
