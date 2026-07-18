// Gmail コレクタ: 直近の受信メールから「要対応候補」を生データで取得する。
// このアカウントは受信メールが即アーカイブされ INBOX に残らない運用のため、
// in:inbox では絞らずアーカイブ済みを含む受信メール全般を候補にする（送信済み・下書き・チャットは除く）。
// トリアージ規則の適用（要対応 / 参考 / 無視 / 除外）は Step 4 の LLM 層が行う。
// ここでは範囲を絞って正規化するだけ（LLM に渡す入力を作る）。
import { gmailClient } from '../auth/google.js';
import { config } from '../config.js';
import type { RawMailCandidate } from '../types.js';

/** now を基準に直近 lookbackDays 日の受信メール候補を取得する。 */
export async function collectGmail(): Promise<RawMailCandidate[]> {
  const gmail = gmailClient();
  const { lookbackDays, maxResults } = config.gmail;

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `newer_than:${lookbackDays}d -in:sent -in:draft -in:chat`,
    maxResults,
  });

  const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);

  const candidates = await Promise.all(
    ids.map(async (id): Promise<RawMailCandidate | null> => {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const msg = res.data;
      const headers = msg.payload?.headers ?? [];
      const header = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      const threadId = msg.threadId ?? id;
      const date = msg.internalDate
        ? new Date(Number.parseInt(msg.internalDate, 10)).toISOString()
        : '';

      return {
        id,
        threadId,
        from: header('From'),
        subject: header('Subject'),
        snippet: decodeSnippet(msg.snippet ?? ''),
        date,
        labelIds: msg.labelIds ?? [],
        // アーカイブ済みスレッドも開けるよう #inbox ではなく #all（すべてのメール）で開く
        gmailLink: `https://mail.google.com/mail/u/0/#all/${threadId}`,
      };
    }),
  );

  return candidates
    .filter((c): c is RawMailCandidate => c !== null)
    .sort((a, b) => b.date.localeCompare(a.date)); // 新しい順
}

/** Gmail の snippet は HTML エンティティを含むことがあるため主要なものだけ復号する。 */
function decodeSnippet(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
