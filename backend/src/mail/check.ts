// `npm run mail:check` — メール通知層の動作確認。
//   npm run mail:check               … NOTIFY_EMAIL_TO 宛にテストメールを実送信（要 gmail.send スコープ）
//   npm run mail:check -- --fixture  … ネットワーク・.env なしで raw メッセージの組み立てを検証
import { config } from '../config.js';
import { buildRawMessage, sendMail } from './send.js';

let failures = 0;
function assertEq(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `（期待 ${String(expected)} / 実際 ${String(actual)}）`}`);
}

/** ネットワークなしで RFC 5322 メッセージの組み立て（日本語件名・本文のエンコード）を確認する。 */
function checkFixture(): void {
  console.log('=== フィクスチャでメール層を検証（ネットワークなし） ===\n');

  const to = 'test@example.com';
  const subject = '[ai-secretary] タスク追加: 牛乳を買う';
  const body = '今日のタスクを追加しました。\n\nタスク: 牛乳を買う\n追加時刻: 2026/08/20 07:00';
  const raw = buildRawMessage(to, subject, body);

  console.log('【raw メッセージ】');
  assertEq('base64url 文字のみ（+ / = を含まない）', /^[A-Za-z0-9_-]+$/.test(raw), true);

  const message = Buffer.from(raw, 'base64url').toString('utf8');
  const sepIdx = message.indexOf('\r\n\r\n');
  assertEq('ヘッダと本文が CRLF 空行で区切られている', sepIdx > 0, true);
  const headers = message.slice(0, sepIdx).split('\r\n');
  const bodyPart = message.slice(sepIdx + 4);

  console.log('\n【ヘッダ】');
  assertEq('To', headers.includes(`To: ${to}`), true);
  assertEq('MIME-Version', headers.includes('MIME-Version: 1.0'), true);
  assertEq('Content-Type', headers.includes('Content-Type: text/plain; charset=UTF-8'), true);
  assertEq('Content-Transfer-Encoding', headers.includes('Content-Transfer-Encoding: base64'), true);
  assertEq('From は書かない（Gmail が me を補完）', headers.some((h) => h.startsWith('From:')), false);

  const subjectHeader = headers.find((h) => h.startsWith('Subject: ')) ?? '';
  const rfc2047 = /^Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(subjectHeader);
  assertEq('Subject は RFC 2047 Base64 形式', rfc2047 !== null, true);
  if (rfc2047) {
    assertEq('件名が復元できる', Buffer.from(rfc2047[1]!, 'base64').toString('utf8'), subject);
  }

  console.log('\n【本文】');
  assertEq('本文が復元できる', Buffer.from(bodyPart, 'base64').toString('utf8'), body);

  console.log(failures === 0 ? '\nすべて成功しました。' : `\n${failures} 件失敗しました。`);
  if (failures > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--fixture')) {
    checkFixture();
    return;
  }

  if (!config.mail.notifyTo) {
    throw new Error('NOTIFY_EMAIL_TO が未設定です。.env に宛先を設定してから再実行してください。');
  }
  console.log(`宛先 ${config.mail.notifyTo} へテストメールを送信します`);
  const now = new Intl.DateTimeFormat('ja-JP', {
    timeZone: config.briefing.tz,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());
  await sendMail(
    '[ai-secretary] メール送信テスト',
    `mail:check からのテストメールです。\n\n送信時刻: ${now}（${config.briefing.tz}）`,
  );
  console.log('  ✓ 送信成功（受信トレイで日本語の件名・本文を確認してください）');
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
