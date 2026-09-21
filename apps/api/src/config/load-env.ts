import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 载入 .env（存在才载入）。进程环境变量优先级高于 .env，便于 docker/CI 覆盖。
 * 必须在 loadConfig() 之前调用。
 */
let loaded = false;

export function loadEnvFiles(): void {
  if (loaded) return;
  loaded = true;
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../.env'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      loadDotenv({ path: file, override: false, quiet: true });
      return;
    }
  }
}
