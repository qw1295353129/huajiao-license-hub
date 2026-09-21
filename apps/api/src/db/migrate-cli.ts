/* eslint-disable no-console */
import { loadEnvFiles } from '../config/load-env';
import { loadConfig } from '../config/configuration';
import { runMigrations } from './migrate';

async function main(): Promise<void> {
  loadEnvFiles();
  const config = loadConfig();
  await runMigrations(config, (msg) => console.log('[migrate] ' + msg));
}

main().catch((error: unknown) => {
  console.error('[migrate] 失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});