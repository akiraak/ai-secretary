// backend 用の自前 Google API アクセス。
// claude.ai の MCP コネクタはこの Claude Code セッション内でしか使えないため、
// g3plus で常時稼働する backend は OAuth リフレッシュトークンで Google API を叩く。
// 単一ユーザー・オフラインアクセス（サービスアカウントは個人 Gmail に届かないため使わない）。
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

// Calendar / Gmail とも読み取り専用。
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
];

/** clientId / clientSecret から OAuth2 クライアントを生成（リフレッシュトークンは任意でセット）。 */
export function createOAuth2Client(redirectUri?: string): OAuth2Client {
  const { clientId, clientSecret } = config.google;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です。.env を確認してください。',
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * リフレッシュトークンをセット済みの認証クライアントを返す（コレクタ用）。
 * GOOGLE_REFRESH_TOKEN が無ければ、`npm run google:auth` で取得するよう促す。
 */
export function getAuthedClient(): OAuth2Client {
  const { refreshToken } = config.google;
  if (!refreshToken) {
    throw new Error(
      'GOOGLE_REFRESH_TOKEN が未設定です。`npm run google:auth` を実行してトークンを取得し .env に貼り付けてください。',
    );
  }
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** 認証済みの Calendar API クライアント。 */
export function calendarClient() {
  return google.calendar({ version: 'v3', auth: getAuthedClient() });
}

/** 認証済みの Gmail API クライアント。 */
export function gmailClient() {
  return google.gmail({ version: 'v1', auth: getAuthedClient() });
}
