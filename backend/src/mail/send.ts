// タスク追加などのユーザー宛メール通知。Gmail API users.messages.send で送る
// （backend は既に googleapis + OAuth リフレッシュトークンで Gmail を読んでいるため流用。
//  gmail.send スコープが必要 — 旧トークンのままだと insufficient scope で失敗する）。
import { gmailClient } from '../auth/google.js';
import { config } from '../config.js';

/** 日本語件名用の RFC 2047 Base64 エンコード（=?UTF-8?B?...?=）。 */
export function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/**
 * RFC 5322 のメッセージを組み立てて users.messages.send 用の base64url にする。
 * From ヘッダは書かない（userId: 'me' の認証アカウントを Gmail 側が補完する）。
 */
export function buildRawMessage(to: string, subject: string, body: string): string {
  const message = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n');
  return Buffer.from(message, 'utf8').toString('base64url');
}

/**
 * NOTIFY_EMAIL_TO 宛にプレーンテキストメールを送る。
 * 宛先未設定なら送らずログのみ（ローカル・テストサーバでの誤送信防止の fail-safe）。
 * @returns 送信したら true、未設定でスキップしたら false
 */
export async function sendMail(subject: string, body: string): Promise<boolean> {
  const to = config.mail.notifyTo;
  if (!to) {
    console.log(`[mail] NOTIFY_EMAIL_TO 未設定のため送信をスキップ: ${subject}`);
    return false;
  }
  await gmailClient().users.messages.send({
    userId: 'me',
    requestBody: { raw: buildRawMessage(to, subject, body) },
  });
  return true;
}

/** ハンドラ組み込み用の fire-and-forget 送信。失敗はログのみで API 応答をブロックしない。 */
export function sendMailInBackground(subject: string, body: string): void {
  void sendMail(subject, body).catch((e) => {
    console.error(`[mail] 送信失敗 (${subject}): ${(e as Error).message}`);
  });
}
