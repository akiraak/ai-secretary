// 買い物リストコレクタ: kitchen-living の共有買い物リスト API から未購入品を取得する。
// レスポンス: { updatedAt, dishes, items: [{ id, name, checked, origin, createdAt(ms), completedAt?(ms) }] }
// checked === false が未購入 = 買うべきもの。追加順（createdAt 昇順）で返す。
import { config } from '../config.js';
import type { ShoppingItem } from '../types.js';

interface RawShoppingItem {
  name?: unknown;
  checked?: unknown;
  origin?: unknown;
  createdAt?: unknown;
}

const FETCH_TIMEOUT_MS = 15_000;

export async function collectShopping(): Promise<ShoppingItem[]> {
  const url = config.shopping.listUrl;
  if (!url) {
    throw new Error('SHOPPING_LIST_URL が未設定です。.env を確認してください。');
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`買い物リスト API がエラーを返しました (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { items?: RawShoppingItem[] };

  return (data.items ?? [])
    .filter(
      (i): i is RawShoppingItem & { name: string } =>
        i != null && i.checked === false && typeof i.name === 'string' && i.name.trim().length > 0,
    )
    .sort((a, b) => (typeof a.createdAt === 'number' ? a.createdAt : 0) - (typeof b.createdAt === 'number' ? b.createdAt : 0))
    .map((i) => ({
      name: i.name.trim(),
      origin: typeof i.origin === 'string' ? i.origin : undefined,
      createdAt: typeof i.createdAt === 'number' ? new Date(i.createdAt).toISOString() : undefined,
    }));
}
