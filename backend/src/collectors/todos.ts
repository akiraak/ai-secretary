// TODO.md コレクタ: GITHUB_REPOS に設定されたリポジトリの TODO.md から
// 未完了タスク（トップレベルの `- [ ]`）を読み取る。
// エントリ形式: `owner/repo` は GitHub API 経由、`/` `.` `~` で始まるパスは
// ローカルの <path>/TODO.md を読む。
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { ghApiRaw, resolveToken } from './github.js';
import type { TodoItem } from '../types.js';

// 1 リポジトリから拾う上限。ブリーフィングは「今日やる/次の作業」が分かれば十分
const MAX_ITEMS_PER_REPO = 10;

function isLocalPath(entry: string): boolean {
  return entry.startsWith('/') || entry.startsWith('.') || entry.startsWith('~');
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * 設定された全リポジトリの TODO.md を読む。読めないリポジトリは警告して飛ばす
 * （1 つの失敗でブリーフィング全体を止めない）。
 */
export async function collectTodos(): Promise<TodoItem[]> {
  const repos = config.github.repos;
  if (repos.length === 0) {
    throw new Error(
      'GITHUB_REPOS が未設定です。TODO.md を読むリポジトリ（owner/repo かローカルパス、カンマ区切り）を .env に設定してください。',
    );
  }

  let token: string | undefined; // リモート指定が無ければトークン解決もしない
  const items: TodoItem[] = [];
  for (const entry of repos) {
    try {
      let markdown: string;
      let repoLabel: string;
      if (isLocalPath(entry)) {
        const dir = expandHome(entry);
        markdown = await readFile(path.join(dir, 'TODO.md'), 'utf8');
        repoLabel = path.basename(path.resolve(dir));
      } else {
        token ??= await resolveToken();
        markdown = await ghApiRaw(`/repos/${entry}/contents/TODO.md`, token);
        repoLabel = entry;
      }
      for (const text of extractTodos(markdown)) {
        items.push({ repo: repoLabel, text });
      }
    } catch (e) {
      console.warn(`[todos] ${entry} の TODO.md を読めませんでした: ${(e as Error).message}`);
    }
  }
  return items;
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
