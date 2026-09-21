import { defineConfig } from 'drizzle-kit';

/** 只用于 `drizzle-kit generate` 生成 SQL 迁移；执行迁移由 src/db/migrate.ts 负责（支持 PGlite）。 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
