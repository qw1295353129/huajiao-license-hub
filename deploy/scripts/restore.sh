#!/usr/bin/env bash
# 从备份恢复：./scripts/restore.sh backups/licensehub-20260921-120000.sql.gz
set -euo pipefail

FILE="${1:?用法: ./scripts/restore.sh <备份文件.sql.gz>}"
[ -f "$FILE" ] || { echo "找不到备份文件：$FILE"; exit 1; }

echo "⚠️  这会覆盖当前数据库内容，5 秒内可 Ctrl+C 取消…"
sleep 5

gunzip -c "$FILE" | docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-licensehub}" -d "${POSTGRES_DB:-licensehub}"

echo "==> 恢复完成。建议执行：docker compose restart api"
