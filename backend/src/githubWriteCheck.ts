// `npm run todo-write:check` — TODO.md 挿入ロジック (insertTodoLine) を fixture で検証する。
// DB・ネットワーク不要。
import assert from 'node:assert/strict';
import { insertTodoLine } from './githubWrite.js';

// --- チェックボックス行あり: 最後のトップレベル行の直後に挿入 ---
{
  const src = '# TODO\n\n- [ ] タスク A\n- [ ] タスク B\n\n## メモ\n\n本文\n';
  assert.equal(
    insertTodoLine(src, '新タスク'),
    '# TODO\n\n- [ ] タスク A\n- [ ] タスク B\n- [ ] 新タスク\n\n## メモ\n\n本文\n',
    '最後のチェックボックス行の直後に入る（後続セクションは動かない）',
  );
}

// --- 子タスクのインデント行が続く場合はその塊の後に挿入 ---
{
  const src = '# TODO\n\n- [ ] 親タスク [plan](docs/plans/x.md)\n  - [ ] Phase 1\n  - [x] Phase 2\n';
  assert.equal(
    insertTodoLine(src, '新タスク'),
    '# TODO\n\n- [ ] 親タスク [plan](docs/plans/x.md)\n  - [ ] Phase 1\n  - [x] Phase 2\n- [ ] 新タスク\n',
    '親と子タスクの間に割り込まない',
  );
}

// --- `- [x]`（完了）のみでも挿入位置になる ---
{
  const src = '# TODO\n\n- [x] 済みタスク\n';
  assert.equal(
    insertTodoLine(src, '新タスク'),
    '# TODO\n\n- [x] 済みタスク\n- [ ] 新タスク\n',
    '- [x] の直後に入る',
  );
}

// --- 末尾改行なしのファイルでも壊れない ---
{
  const src = '# TODO\n\n- [ ] タスク A';
  assert.equal(
    insertTodoLine(src, '新タスク'),
    '# TODO\n\n- [ ] タスク A\n- [ ] 新タスク',
    '末尾改行なしでも行として追加される',
  );
}

// --- チェックボックス行なし: 末尾に追記（末尾改行を整える） ---
{
  assert.equal(
    insertTodoLine('# TODO\n\nメモだけ', '新タスク'),
    '# TODO\n\nメモだけ\n- [ ] 新タスク\n',
    '末尾改行なし + チェックボックスなしは改行を補って追記',
  );
  assert.equal(
    insertTodoLine('# TODO\n', '新タスク'),
    '# TODO\n- [ ] 新タスク\n',
    '見出しのみのファイルは末尾に追記',
  );
  assert.equal(insertTodoLine('', '新タスク'), '- [ ] 新タスク\n', '空ファイルは 1 行だけになる');
}

// --- インデント付きチェックボックスだけの場合はトップレベル扱いしない ---
{
  const src = '# TODO\n\n  - [ ] インデント付き\n';
  assert.equal(
    insertTodoLine(src, '新タスク'),
    '# TODO\n\n  - [ ] インデント付き\n- [ ] 新タスク\n',
    'トップレベル行が無ければ末尾追記になる',
  );
}

console.log('githubWriteCheck: ok');
