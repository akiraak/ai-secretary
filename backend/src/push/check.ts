// `npm run apns:check` — APNs 送信層の動作確認。
//   npm run apns:check                   … 登録済み全デバイスへテスト通知を送る（要 APNS_* 設定）
//   npm run apns:check -- --token <hex>  … 指定トークンへテスト通知（DB 登録前の実機検証用）
//   npm run apns:check -- --briefing     … DB の最新ブリーフィングを再 push（LLM 再生成なし）
//   npm run apns:check -- --fixture      … ネットワーク・.env なしで JWT 生成と payload 組み立てを検証
import { generateKeyPairSync, verify } from 'node:crypto';
import { closeDb } from '../db/index.js';
import { latestBriefing, listDevices } from '../db/repo.js';
import { createApnsJwt, resolveApnsSettings, sendApnsAlerts } from './apns.js';
import {
  APNS_MAX_PAYLOAD_BYTES,
  buildBriefingPushPayload,
  pushBriefingToDevices,
  type BriefingForPush,
} from './briefingPush.js';

let failures = 0;
function assertEq(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `（期待 ${String(expected)} / 実際 ${String(actual)}）`}`);
}

/** ネットワークなしで JWT（一時 P-256 鍵で署名→検証）と payload の 4KB トリムを確認する。 */
function checkFixture(): void {
  console.log('=== フィクスチャで APNs 層を検証（ネットワークなし） ===\n');

  console.log('【ES256 JWT】');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const issuedAt = 1_752_000_000; // 固定値（再現性のため）
  const jwt = createApnsJwt({ key: privateKey, keyId: 'KEYID12345', teamId: 'TEAM123456' }, issuedAt);
  const [h, c, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h!, 'base64url').toString('utf8')) as Record<string, unknown>;
  const claims = JSON.parse(Buffer.from(c!, 'base64url').toString('utf8')) as Record<string, unknown>;
  const signature = Buffer.from(s!, 'base64url');
  assertEq('ヘッダ alg', header.alg, 'ES256');
  assertEq('ヘッダ kid', header.kid, 'KEYID12345');
  assertEq('クレーム iss', claims.iss, 'TEAM123456');
  assertEq('クレーム iat', claims.iat, issuedAt);
  assertEq('署名は JOSE 形式 (r||s = 64 バイト)', signature.length, 64);
  assertEq(
    '公開鍵での署名検証',
    verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature),
    true,
  );

  console.log('\n【payload 組み立て】');
  const small: BriefingForPush = {
    id: 1,
    briefing_date: '2026-07-15',
    title: '7/15 朝ブリーフィング',
    summary: '締切 2 件・要対応メール 1 件があります。',
    payload_json: JSON.stringify({ date: '2026-07-15', lang: 'ja', deadlines: [], mails: [] }),
  };
  const smallResult = buildBriefingPushPayload(small);
  assertEq('4KB 以内はフル内容（briefing キーあり）', 'briefing' in smallResult.payload, true);
  assertEq('4KB 以内は trimmed=false', smallResult.trimmed, false);
  const aps = smallResult.payload.aps as { alert: { title: string; body: string } };
  assertEq('alert.title は briefings.title', aps.alert.title, small.title);
  assertEq('alert.body は briefings.summary', aps.alert.body, small.summary);

  const big: BriefingForPush = {
    ...small,
    payload_json: JSON.stringify({
      todos: Array.from({ length: 200 }, (_, i) => ({ repo: 'repo', text: `とても長いタスク ${i} `.repeat(10) })),
    }),
  };
  const bigResult = buildBriefingPushPayload(big);
  assertEq('4KB 超過はシグナルのみ（briefing キーなし）', 'briefing' in bigResult.payload, false);
  assertEq('4KB 超過は trimmed=true', bigResult.trimmed, true);
  assertEq('シグナルのみでも briefingId は残る', bigResult.payload.briefingId, big.id);
  assertEq(
    'トリム後は 4KB 以内',
    Buffer.byteLength(JSON.stringify(bigResult.payload), 'utf8') <= APNS_MAX_PAYLOAD_BYTES,
    true,
  );

  console.log(failures === 0 ? '\nすべて成功しました。' : `\n${failures} 件失敗しました。`);
  if (failures > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--fixture')) {
    checkFixture();
    return;
  }

  const settings = resolveApnsSettings();
  console.log(`APNs: ${settings.host} / topic: ${settings.bundleId}\n`);

  // 最新ブリーフィングの再 push（収集・LLM を回さず push だけ試す）
  if (args.includes('--briefing')) {
    const row = latestBriefing();
    if (!row) {
      throw new Error('DB にブリーフィングがありません。先に `npm run briefing` を実行してください。');
    }
    console.log(`最新ブリーフィング (id=${row.id}, ${row.briefing_date}) を再 push します`);
    const result = await pushBriefingToDevices(row);
    for (const m of result.messages) console.log(m);
    console.log(`送信 ${result.sent} / 失敗 ${result.failed}`);
    if (result.sent === 0) process.exitCode = 1;
    return;
  }

  // テスト通知の宛先: --token 指定があればそれ、なければ DB の登録デバイス
  const tokenIdx = args.indexOf('--token');
  let tokens: string[];
  if (tokenIdx >= 0) {
    const token = args[tokenIdx + 1];
    if (!token) throw new Error('--token の後にデバイストークンを指定してください。');
    tokens = [token];
  } else {
    tokens = listDevices()
      .filter((d) => d.platform === 'ios')
      .map((d) => d.token);
    if (tokens.length === 0) {
      throw new Error(
        '登録デバイスがありません。iOS アプリから POST /devices で登録するか、`-- --token <hex>` で指定してください。',
      );
    }
  }

  const payload = {
    aps: { alert: { title: 'AI 秘書', body: 'APNs 接続テスト通知です。' }, sound: 'default' },
  };
  console.log(`${tokens.length} 台へテスト通知を送信します`);
  const results = await sendApnsAlerts(settings, tokens.map((t) => ({ deviceToken: t, payload })));
  for (const r of results) {
    const label = `${r.deviceToken.slice(0, 8)}…`;
    if (r.status === 200) {
      console.log(`  ✓ ${label} 送信成功 (apns-id: ${r.apnsId ?? '-'})`);
    } else {
      console.log(`  ✗ ${label} HTTP ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
