// TODO.md コレクタ: GITHUB_REPOS に設定されたリポジトリの TODO.md から
// 未完了タスク（トップレベルの `- [ ]`）を読み取る。
// エントリ形式: `owner/repo` は GitHub API 経由、`/` `.` `~` で始まるパスは
// ローカルの <path>/TODO.md を読む。`*` はトークンで見える全リポジトリ
// （fork・archived 除く）への展開。
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { GhHttpError, ghApiRaw, listAccessibleRepos, resolveToken } from './github.js';
import type { TodoItem } from '../types.js';

// 1 リポジトリから拾う上限。ブリーフィングは「今日やる/次の作業」が分かれば十分
const MAX_ITEMS_PER_REPO = 10;
// `*` 展開で対象が ~100 になるため contents 取得は並列で行う
const FETCH_CONCURRENCY = 8;
// 全アクセス可能リポジトリへの展開を指すエントリ
const AUTO_ENTRY = '*';

function isLocalPath(entry: string): boolean {
  return entry.startsWith('/') || entry.startsWith('.') || entry.startsWith('~');
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** 読み取り対象 1 件。auto = `*` 展開由来（TODO.md 無しの 404 は正常系）。 */
interface TodoTarget {
  entry: string;
  auto: boolean;
}

/**
 * 設定された全リポジトリの TODO.md を読む。読めないリポジトリは警告して飛ばす
 * （1 つの失敗でブリーフィング全体を止めない）。`*` はトークンで見える
 * 全リポジトリに展開し、TODO.md が無いもの（404）は警告なしでスキップする。
 */
export async function collectTodos(): Promise<TodoItem[]> {
  const entries = config.github.repos;
  if (entries.length === 0) {
    throw new Error(
      'GITHUB_REPOS が未設定です。TODO.md を読むリポジトリ（owner/repo かローカルパス、カンマ区切り。`*` で全リポジトリ）を .env に設定してください。',
    );
  }

  // リモート指定が無ければトークン解決もしない（並列取得でも 1 回だけ解決する）
  let tokenPromise: Promise<string> | undefined;
  const getToken = () => (tokenPromise ??= resolveToken());

  const explicit = entries.filter((e) => e !== AUTO_ENTRY);
  const targets: TodoTarget[] = explicit.map((entry) => ({ entry, auto: false }));
  if (entries.includes(AUTO_ENTRY)) {
    const known = new Set(explicit);
    for (const name of await listAccessibleRepos(await getToken())) {
      if (!known.has(name)) targets.push({ entry: name, auto: true });
    }
  }

  // 並列プール（結果は targets の順を保つ）
  const results: TodoItem[][] = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      results[i] = await readTarget(targets[i]!, getToken);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, targets.length) }, worker),
  );
  return results.flat();
}

/** 1 リポジトリ分の TODO.md を読んで抽出する。失敗は警告して空を返す。 */
async function readTarget(
  target: TodoTarget,
  getToken: () => Promise<string>,
): Promise<TodoItem[]> {
  try {
    let markdown: string;
    let repoLabel: string;
    if (isLocalPath(target.entry)) {
      const dir = expandHome(target.entry);
      markdown = await readFile(path.join(dir, 'TODO.md'), 'utf8');
      repoLabel = path.basename(path.resolve(dir));
    } else {
      markdown = await ghApiRaw(`/repos/${target.entry}/contents/TODO.md`, await getToken());
      repoLabel = target.entry;
    }
    return extractTodos(markdown).map((text) => ({ repo: repoLabel, text }));
  } catch (e) {
    // `*` 展開由来のリポジトリに TODO.md が無いのは正常系
    if (target.auto && e instanceof GhHttpError && e.status === 404) return [];
    console.warn(`[todos] ${target.entry} の TODO.md を読めませんでした: ${(e as Error).message}`);
    return [];
  }
}

/**
 * TODO.md からトップレベルの未完了タスクを抽出する。
 * インデント付き（子タスク）は Step の内訳なので拾わない。
 * Markdown リンクはラベルだけ残す（例: `[plan](docs/...)` → `plan`）。
 */
export function extractTodos(markdown: string, limit = MAX_ITEMS_PER_REPO): string[] {
  const items: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^- \[ \] (.+)$/.exec(line);
    if (!m) continue;
    const text = m[1]!.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
    if (text) items.push(text);
    if (items.length >= limit) break;
  }
  return items;
}
