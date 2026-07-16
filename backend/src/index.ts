// backend エントリポイント。API サーバを起動する（`npm run dev` / `npm start`）。
// ブリーフィング生成は別プロセス（`npm run briefing`、Step 8 で cron から実行）。
import { startServer } from './server.js';

try {
  startServer();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
