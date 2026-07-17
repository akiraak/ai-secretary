// `npm run diff:check` — カレンダー変更検知 (calendarDiff) の純粋ロジックを fixture で検証する。
// DB・ネットワーク・.env 不要。
import assert from 'node:assert/strict';
import {
  annotateChanges,
  buildCalendarSnapshot,
  buildCanvasSnapshot,
  diffCalendarItems,
  type SnapshotItem,
} from './calendarDiff.js';
import type { DeadlineItem, EventItem } from '../types.js';

const TZ = 'America/Los_Angeles';
const TODAY = '2026-07-17';
const CUTOFF = '2026-08-16'; // 窓 31 日の最終日

const item = (key: string, start: string, title: string, extra = ''): SnapshotItem => ({
  key,
  fingerprint: `${start}|${title}${extra}`,
  start_at: start,
  title,
});

const base = { source: 'calendar' as const, today: TODAY, newCutoff: CUTOFF, tz: TZ };

// --- 新規: 前回に無いキーは new。ただし窓の末端 (>= newCutoff) は出さない ---
{
  const prev = [item('gcal:a', '2026-07-18T10:00:00-07:00', '既存')];
  const current = [
    ...prev,
    item('gcal:b', '2026-07-20T09:00:00-07:00', '新しい予定'),
    item('gcal:c', '2026-08-16T09:00:00-07:00', '窓に入っただけ'),
  ];
  const { changes, changedKeys } = diffCalendarItems({ ...base, prev, current });
  assert.deepEqual(
    changes.map((c) => [c.kind, c.title]),
    [['new', '新しい予定']],
    '新規は窓末端を除いて 1 件',
  );
  assert.equal(changedKeys.get('gcal:b'), 'new');
  assert.ok(!changedKeys.has('gcal:c'), '窓末端の新出は changed を付けない');
}

// --- 変更: fingerprint が違えば updated。時刻移動は detail に旧→新 ---
{
  const prev = [item('gcal:a', '2026-07-20T10:00:00-07:00', 'ミーティング')];
  const current = [item('gcal:a', '2026-07-21T11:00:00-07:00', 'ミーティング')];
  const { changes, changedKeys } = diffCalendarItems({ ...base, prev, current });
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.kind, 'updated');
  assert.match(changes[0]!.detail!, /→/, '時刻移動の detail は旧→新');
  assert.equal(changedKeys.get('gcal:a'), 'updated');
}

// --- 削除: 前回に在って今回に無い未来の calendar 項目だけ removed ---
{
  const prev = [
    item('gcal:past', '2026-07-16T10:00:00-07:00', '過去へスクロールアウト'),
    item('gcal:future', '2026-07-25T10:00:00-07:00', 'キャンセルされた予定'),
    item('gcal:allday', '2026-07-30', '消えた終日予定'),
  ];
  const { changes } = diffCalendarItems({ ...base, prev, current: [] });
  assert.deepEqual(
    changes.map((c) => [c.kind, c.title]).sort(),
    [
      ['removed', 'キャンセルされた予定'],
      ['removed', '消えた終日予定'],
    ],
    '過去開始の消失は削除にしない',
  );
}

// --- Canvas: 削除は出さない / 新規・変更は出す ---
{
  const prev = [
    item('canvas:u1', '2026-07-20T23:59:00-07:00', '消えた課題'),
    item('canvas:u2', '2026-07-21T23:59:00-07:00', '締切が動く課題'),
  ];
  const current = [
    item('canvas:u2', '2026-07-22T23:59:00-07:00', '締切が動く課題'),
    item('canvas:u3', '2026-07-19T23:59:00-07:00', '新しい課題'),
  ];
  const { changes } = diffCalendarItems({
    ...base,
    source: 'canvas',
    newCutoff: '2026-07-23',
    prev,
    current,
  });
  assert.deepEqual(
    changes.map((c) => [c.kind, c.title]).sort(),
    [
      ['new', '新しい課題'],
      ['updated', '締切が動く課題'],
    ],
    'canvas は removed を出さない',
  );
}

// --- スナップショット構築: id/uid の無い項目は除外、重複キーは先勝ち ---
{
  const events: EventItem[] = [
    { id: 'e1', title: 'A', startAt: '2026-07-18T10:00:00-07:00' },
    { title: 'ID なし', startAt: '2026-07-18T11:00:00-07:00' },
    { id: 'e1', title: 'A 重複', startAt: '2026-07-18T10:00:00-07:00' },
  ];
  const deadlines: DeadlineItem[] = [
    { source: 'calendar', title: '終日', dueAt: '2026-07-20', id: 'e2' },
    { source: 'calendar', title: 'ID なし終日', dueAt: '2026-07-21' },
    { source: 'canvas', title: '課題', dueAt: '2026-07-22T23:59:00-07:00', uid: 'event-assignment-1' },
    { source: 'canvas', title: 'UID なし課題', dueAt: '2026-07-23' },
  ];
  assert.deepEqual(
    buildCalendarSnapshot(events, deadlines).map((s) => s.key).sort(),
    ['gcal:e1', 'gcal:e2'],
  );
  assert.deepEqual(buildCanvasSnapshot(deadlines).map((s) => s.key), [
    'canvas:event-assignment-1',
  ]);
}

// --- annotateChanges: events / todayEvents / deadlines に changed が付く ---
{
  const ev: EventItem = { id: 'e1', title: 'A', startAt: '2026-07-18T10:00:00-07:00' };
  const input = {
    events: [ev],
    todayEvents: [ev],
    deadlines: [
      { source: 'canvas', title: '課題', dueAt: '2026-07-22', uid: 'event-assignment-1' },
      { source: 'calendar', title: '終日', dueAt: '2026-07-20', id: 'e2' },
    ] as DeadlineItem[],
  };
  annotateChanges(
    input,
    new Map([
      ['gcal:e1', 'new'],
      ['canvas:event-assignment-1', 'updated'],
    ]),
  );
  assert.equal(input.events[0]!.changed, 'new');
  assert.equal(input.todayEvents[0]!.changed, 'new');
  assert.equal(input.deadlines[0]!.changed, 'updated');
  assert.equal(input.deadlines[1]!.changed, undefined);
}

console.log('calendarDiff: 全チェック OK');
