// APNs (Apple Push Notification service) クライアント。
// 依存ライブラリなし: プロバイダトークン (ES256 JWT) は node:crypto、送信は node:http2 で行う。
// 参照: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import http2 from 'node:http2';
import { config } from '../config.js';

/** APNs 送信に必要な設定一式（.env から解決済み）。 */
export interface ApnsSettings {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: KeyObject;
  host: string; // api.sandbox.push.apple.com | api.push.apple.com
}

export interface ApnsNotification {
  deviceToken: string;
  /** JSON ボディ全体（aps キーを含む） */
  payload: unknown;
}

export interface ApnsResult {
  deviceToken: string;
  /** HTTP ステータス（0 = リクエスト自体が失敗） */
  status: number;
  apnsId?: string;
  /** APNs のエラー理由（BadDeviceToken 等）または例外メッセージ */
  reason?: string;
  /** 410 Unregistered = トークンが無効。devices から削除してよい */
  gone: boolean;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** .env の APNS_* を検証し、.p8 鍵を読み込んで設定を組み立てる。不足時は案内付きで throw。 */
export function resolveApnsSettings(): ApnsSettings {
  const { keyId, teamId, bundleId, p8Path, env } = config.apns;
  const missing = [
    !keyId && 'APNS_KEY_ID',
    !teamId && 'APNS_TEAM_ID',
    !bundleId && 'APNS_BUNDLE_ID',
    !p8Path && 'APNS_P8_PATH',
  ].filter((v): v is string => typeof v === 'string');
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} が未設定です。Apple Developer の「Certificates, Identifiers & Profiles → Keys」で ` +
        'APNs 認証キー (.p8) を作成し、.env に設定してください。',
    );
  }

  let key: KeyObject;
  try {
    key = createPrivateKey(readFileSync(p8Path!, 'utf8'));
  } catch (e) {
    throw new Error(`APNs 認証キー (${p8Path}) を読み込めませんでした: ${(e as Error).message}`);
  }
  if (key.asymmetricKeyType !== 'ec') {
    throw new Error(`APNs 認証キーは EC (P-256) 秘密鍵が必要です（実際: ${key.asymmetricKeyType}）`);
  }

  return {
    keyId: keyId!,
    teamId: teamId!,
    bundleId: bundleId!,
    key,
    host: env === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com',
  };
}

/** APNs プロバイダトークン (ES256 JWT)。署名は JOSE 形式 (r||s の 64 バイト) なので ieee-p1363 を指定する。 */
export function createApnsJwt(
  settings: Pick<ApnsSettings, 'key' | 'keyId' | 'teamId'>,
  issuedAt: number = Math.floor(Date.now() / 1000),
): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${enc({ alg: 'ES256', kid: settings.keyId })}.${enc({ iss: settings.teamId, iat: issuedAt })}`;
  const signature = sign('sha256', Buffer.from(input), { key: settings.key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

/** 1 つの HTTP/2 接続で全デバイスへ順に alert push を送る（単一ユーザーでデバイス数は少ない想定）。 */
export async function sendApnsAlerts(
  settings: ApnsSettings,
  notifications: ApnsNotification[],
): Promise<ApnsResult[]> {
  if (notifications.length === 0) return [];
  const jwt = createApnsJwt(settings);
  const session = await connect(settings.host);
  try {
    const results: ApnsResult[] = [];
    for (const n of notifications) {
      results.push(await sendOne(session, settings, jwt, n));
    }
    return results;
  } finally {
    session.close();
  }
}

function connect(host: string): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://${host}`);
    const onError = (e: Error) => reject(new Error(`APNs (${host}) に接続できませんでした: ${e.message}`));
    session.once('error', onError);
    session.once('connect', () => {
      session.removeListener('error', onError);
      // 以降のセッションエラーは各リクエストの error イベントで拾う（未処理 throw でプロセスを落とさない）
      session.on('error', () => {});
      resolve(session);
    });
  });
}

function sendOne(
  session: http2.ClientHttp2Session,
  settings: ApnsSettings,
  jwt: string,
  n: ApnsNotification,
): Promise<ApnsResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify(n.payload);
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${n.deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': settings.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });

    let status = 0;
    let apnsId: string | undefined;
    let settled = false;
    const chunks: Buffer[] = [];
    const done = (reason?: string) => {
      if (settled) return;
      settled = true;
      resolve({ deviceToken: n.deviceToken, status, apnsId, reason, gone: status === 410 });
    };

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      done('APNs 応答がタイムアウトしました');
    });
    req.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
      const id = headers['apns-id'];
      apnsId = typeof id === 'string' ? id : undefined;
    });
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let reason: string | undefined;
      const text = Buffer.concat(chunks).toString('utf8');
      if (status !== 200 && text) {
        try {
          reason = (JSON.parse(text) as { reason?: string }).reason ?? text;
        } catch {
          reason = text;
        }
      }
      done(reason);
    });
    req.on('error', (e) => done(`送信エラー: ${e.message}`));
    req.end(body);
  });
}
