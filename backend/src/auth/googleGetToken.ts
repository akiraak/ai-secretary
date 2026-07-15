// `npm run google:auth` — リフレッシュトークンを一度だけ取得する CLI。
//
// 前提: Google Cloud で「デスクトップアプリ」種別の OAuth クライアントを作成し、
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を .env に設定しておく。
// デスクトップクライアントはループバック (http://localhost:PORT) への
// リダイレクトが事前登録なしで許可される。
//
// 実行するとブラウザで開く URL を表示 → 認可 → localhost に戻る → 認可コードを
// トークンに交換し、GOOGLE_REFRESH_TOKEN を標準出力に表示する。表示された値を
// .env に貼り付ければ backend が Google API を叩けるようになる。
import http from 'node:http';
import { URL } from 'node:url';
import { createOAuth2Client, GOOGLE_SCOPES } from './google.js';
import { config } from '../config.js';

const port = config.google.oauthPort;
const redirectUri = `http://localhost:${port}`;

function html(body: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">${body}</body>`;
}

async function main(): Promise<void> {
  const client = createOAuth2Client(redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline', // リフレッシュトークンを得るため必須
    prompt: 'consent', // 既存同意でも必ず refresh_token を返させる
    scope: GOOGLE_SCOPES,
  });

  console.log('\n=== Google OAuth ===');
  console.log('以下の URL をブラウザで開いて認可してください:\n');
  console.log(authUrl);
  console.log(`\n認可後、${redirectUri} へリダイレクトされます（このスクリプトが受け取ります）。\n`);

  const code = await waitForCode();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      '\n[エラー] refresh_token が返りませんでした。Google アカウントの「サードパーティ アクセス」から\n' +
        '当該アプリの権限を一度解除してから再実行してください。',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\n取得成功。以下を .env の GOOGLE_REFRESH_TOKEN に貼り付けてください:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  if (tokens.scope) console.log(`(scope: ${tokens.scope})`);
}

/** ループバックサーバを立て、認可コードを 1 回だけ受け取って返す。 */
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', redirectUri);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html(`認可エラー: ${error}。ターミナルに戻ってください。`));
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (!code) {
          // favicon など code を含まないリクエストは無視
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html('認可が完了しました。ターミナルに戻ってください。'));
        server.close();
        resolve(code);
      } catch (e) {
        server.close();
        reject(e as Error);
      }
    });
    server.on('error', reject);
    server.listen(port, () => {
      console.log(`ループバックサーバ待受中: ${redirectUri}`);
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
