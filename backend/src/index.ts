// backend エントリポイント（雛形）。
// Step 5 で API サーバ、Step 8 で cron を実装する。現時点では DB 初期化のみ確認する。
import { getDb, closeDb } from './db/index.js';
import { config } from './config.js';

function main(): void {
  const db = getDb();
  const count = db.prepare('SELECT count(*) AS n FROM briefings').get() as { n: number };
  console.log('ai-secretary backend');
  console.log(`  DB       : ${config.db.path}`);
  console.log(`  model    : ${config.llm.model}`);
  console.log(`  timezone : ${config.briefing.tz} (briefing ${config.briefing.hour}:00)`);
  console.log(`  briefings: ${count.n} 件`);
  console.log('TODO: Step 5 で API サーバ、Step 8 で cron を実装する。');
  closeDb();
}

main();
