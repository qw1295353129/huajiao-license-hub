/* eslint-disable no-console */
import { loadEnvFiles } from '../config/load-env';
import { loadConfig } from '../config/configuration';
import { describeError } from './error-format';
import { runMigrations } from './migrate';

async function main(): Promise<void> {
  loadEnvFiles();
  const config = loadConfig();
  await runMigrations(config, (msg) => console.log('[migrate] ' + msg));
}

main().catch((error: unknown) => {
  console.error('[migrate] 失败：', describeError(error));
  process.exitCode = 1;
});