#!/usr/bin/env bash
# 数据库备份：保留最近 14 天，支持可选异地推送
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "==> 备份到 $BACKUP_DIR/licensehub-$STAMP.sql.gz"
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-licensehub}" -d "${POSTGRES_DB:-licensehub}" --clean --if-exists \
  | gzip > "$BACKUP_DIR/licensehub-$STAMP.sql.gz"

echo "==> 清理 $KEEP_DAYS 天前的备份"
find "$BACKUP_DIR" -name 'licensehub-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "==> 推送到异地：$BACKUP_REMOTE"
  rsync -az "$BACKUP_DIR/licensehub-$STAMP.sql.gz" "$BACKUP_REMOTE"
fi

echo "==> 完成：$(du -h "$BACKUP_DIR/licensehub-$STAMP.sql.gz" | cut -f1)"
