// アプリからリポジトリの TODO.md へタスクを 1 行追記する書き込みモジュール。
// GitHub Contents API で TODO.md を取得 → `- [ ] <text>` を挿入 → コミット（PUT）する。
// 読み取り系コレクタ（collectors/github.ts）と違い書き込みを行うため、
// トークンには対象リポジトリの Contents: Read and write 権限が必要。
import { GhHttpError, resolveToken } from './collectors/github.js';

const API_BASE = 'https://api.github.com';
const TODO_PATH = 'TODO.md';

/** 呼び出し側（server.ts）が HTTP ステータスへそのまま変換できるエラー。 */
export class RepoTodoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/**
 * TODO.md に `- [ ] <text>` を挿入した Markdown を返す純関数。
 * 挿入位置は最後のトップレベル `- [ ]` / `- [x]` 行の直後
 * （子タスク等のインデント行が続く場合はその塊の後）。
 * チェックボックス行が 1 つも無ければ末尾に追記する（末尾改行は整える）。
 */
export function insertTodoLine(markdown: string, text: string): string {
  const lines = markdown.split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^- \[[ xX]\] /.test(lines[i]!)) last = i;
  }
  if (last === -1) {
    const base = markdown.length === 0 || markdown.endsWith('\n') ? markdown : `${markdown}\n`;
    return `${base}- [ ] ${text}\n`;
  }
  let insertAt = last + 1;
  while (insertAt < lines.length && /^\s+\S/.test(lines[insertAt]!)) insertAt++;
  lines.splice(insertAt, 0, `- [ ] ${text}`);
  return lines.join('\n');
}

interface ContentsFile {
  type?: string;
  content: string;
  sha: string;
}

/** TODO.md の現在の内容と sha を取得する。無ければ null（新規作成する）。 */
async function fetchTodoFile(repo: string, token: string): Promise<ContentsFile | null> {
  const apiPath = `/repos/${repo}/contents/${TODO_PATH}`;
  const res = await fetch(`${API_BASE}${apiPath}`, { headers: headers(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new GhHttpError(apiPath, res.status);
  const file = (await res.json()) as ContentsFile;
  if (file.type && file.type !== 'file') {
    throw new RepoTodoError(502, `${repo} の ${TODO_PATH} がファイルではありません (${file.type})`);
  }
  return file;
}

/** TODO.md をコミットする。失敗はステータスだけ返し、リトライ判断は呼び出し側で行う。 */
async function putTodoFile(
  repo: string,
  token: string,
  markdown: string,
  sha: string | undefined,
  message: string,
): Promise<{ ok: boolean; status: number; url?: string }> {
  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${TODO_PATH}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message,
      content: Buffer.from(markdown, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = (await res.json()) as { commit?: { html_url?: string } };
  return { ok: true, status: res.status, url: json.commit?.html_url };
}

/**
 * repo の TODO.md へ `- [ ] <text>` を 1 行追記してコミットする。
 * TODO.md が無ければ `# TODO` 見出し付きで新規作成する。
 * sha 衝突（409/422）は再取得して 1 回だけリトライする。
 * 失敗は RepoTodoError（HTTP ステータス + 日本語の理由）で投げる。
 */
export async function addRepoTodo(repo: string, text: string): Promise<{ url?: string }> {
  const token = await resolveToken();
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await fetchTodoFile(repo, token);
    const markdown = file
      ? insertTodoLine(Buffer.from(file.content, 'base64').toString('utf8'), text)
      : `# TODO\n\n- [ ] ${text}\n`;
    const result = await putTodoFile(repo, token, markdown, file?.sha, `TODO 追加: ${text}`);
    if (result.ok) return { url: result.url };
    // fine-grained トークンで書き込み権限が無い場合、GitHub は 404 を返すこともある
    if (result.status === 403 || result.status === 404) {
      throw new RepoTodoError(
        403,
        'GitHub トークンに書き込み権限がありません（対象リポジトリの Contents: Read and write が必要）',
      );
    }
    if ((result.status === 409 || result.status === 422) && attempt === 0) continue;
    throw new RepoTodoError(502, `GitHub への書き込みに失敗しました (HTTP ${result.status})`);
  }
  throw new RepoTodoError(502, 'TODO.md の更新が競合しました。もう一度お試しください');
}
