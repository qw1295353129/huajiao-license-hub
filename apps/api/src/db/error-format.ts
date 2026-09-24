/**
 * 打印错误链：drizzle 的 DrizzleQueryError 把数据库真正的原因放在 cause 里，
 * 只打印 message 会留下一句「Failed query: CREATE SCHEMA … params:」看不出根因 —— 实战中让
 * 「权限不足 / 表不存在 / 认证失败」这类关键信息全被吞掉，排查成本极高。
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines: string[] = [error.message];
  const seen = new Set<unknown>([error]);
  let cause: unknown = (error as { cause?: unknown }).cause;
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    lines.push('↳ ' + cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  const text = lines.join('\n');
  if (/permission denied|must be owner/i.test(text)) {
    lines.push('提示：连接用的数据库角色权限不足。用超级用户执行：'
      + 'ALTER DATABASE <库名> OWNER TO <角色名>; 或 GRANT CREATE ON DATABASE <库名> TO <角色名>;');
  } else if (/does not exist|不存在/.test(text)) {
    lines.push('提示：数据库表可能还没建。执行：docker compose run --rm --no-deps api node dist/db/migrate-cli.js');
  } else if (/authentication failed|password/i.test(text)) {
    lines.push('提示：数据库口令与数据卷里已初始化的口令不一致。用超级用户执行：'
      + 'ALTER USER <角色名> WITH PASSWORD \'新口令\'; 并同步修改 deploy/.env 的 POSTGRES_PASSWORD');
  }
  return lines.join('\n');
}
