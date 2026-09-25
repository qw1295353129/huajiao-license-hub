#!/usr/bin/env bash
# 一键生成 / 修复 deploy/.env（与 apps/api/src/config/configuration.ts 的生产校验同规则）：
#
#   DATA_KEY                  base64 解码后必须 32 字节（44 字符）
#   JWT_SECRET                ≥ 32 字符
#   LICENSE_PEPPER            ≥ 32 字符
#   BOOTSTRAP_ADMIN_PASSWORD  非空、≠ Admin@12345、≥ 12 字符
#   POSTGRES/REDIS_PASSWORD   URL 安全字符集（不含 / + % $ 空格，避免连接串踩坑）
#
# 用法：
#   bash init-env.sh                 # 修复/补齐 .env（保留已有合法值，坏值替换）
#   docker compose up -d --force-recreate
#
# 说明：
#   · 已有合法的 POSTGRES_PASSWORD 不会被改动；一旦被替换，脚本会同步 ALTER 数据库口令
#     （数据卷里的旧口令不会随 .env 变化，这是 api 反复崩溃最常见的原因）。
#   · 只打印非敏感信息；初始管理员密码请查看 .env 里的 BOOTSTRAP_ADMIN_PASSWORD。
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env
EXAMPLE=.env.example
summary=()

say()  { printf '%s\n' "$*"; }
hexn() { openssl rand -hex "${1:-24}"; }
b64n() { openssl rand -base64 "$1" | tr -d '\n'; }

is_placeholder() {
  case "$1" in
    ''|CHANGE_ME*|change_me*|dev-only*|Admin@12345) return 0 ;;
  esac
  return 1
}
urlsafe() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._~-]+$'; }
data_key_ok() { [ "$(printf '%s' "$1" | base64 -d 2>/dev/null | wc -c | tr -d ' ')" = "32" ]; }

get_val() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

set_val() {
  local k=$1 v=$2 tmp
  tmp=$(mktemp)
  if grep -q "^${k}=" "$ENV_FILE"; then
    awk -v k="$k" -v v="$v" 'BEGIN{d=0} !d && index($0,k"=")==1 {print k"="v; d=1; next} {print}' \
      "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$k" "$v" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

# 记录：保留 / 生成
keep() { summary+=("  保留   $1"); }
gen()  { summary+=("  生成   $1"); }
fix()  { summary+=("  替换   $1  ($2)"); }

# ---------- 1. 准备 .env ----------
if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE" ]; then
    say "✖ 找不到 $ENV_FILE 也找不到 $EXAMPLE，确认在 deploy/ 目录下执行"; exit 1
  fi
  cp "$EXAMPLE" "$ENV_FILE"
  gen ".env（从 .env.example 创建）"
else
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  say "已备份 → $ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
fi

# ---------- 2. 逐项校验 / 生成 ----------
pg_password_changed=0

v=$(get_val POSTGRES_PASSWORD)
if is_placeholder "$v" || ! urlsafe "$v"; then
  set_val POSTGRES_PASSWORD "$(hexn 24)"; pg_password_changed=1
  fix POSTGRES_PASSWORD "非 URL 安全或占位符"
else
  keep POSTGRES_PASSWORD
fi

v=$(get_val REDIS_PASSWORD)
if is_placeholder "$v" || ! urlsafe "$v"; then
  set_val REDIS_PASSWORD "$(hexn 24)"
  fix REDIS_PASSWORD "非 URL 安全或占位符"
else
  keep REDIS_PASSWORD
fi

v=$(get_val JWT_SECRET)
if is_placeholder "$v"; then
  set_val JWT_SECRET "$(b64n 48)"; fix JWT_SECRET "占位符或示例值（长度 ${#v}）"
elif [ "${#v}" -lt 32 ]; then
  set_val JWT_SECRET "$(b64n 48)"; fix JWT_SECRET "长度 ${#v} < 32"
else keep JWT_SECRET; fi

v=$(get_val LICENSE_PEPPER)
if is_placeholder "$v"; then
  set_val LICENSE_PEPPER "$(b64n 48)"; fix LICENSE_PEPPER "占位符或示例值（长度 ${#v}）"
elif [ "${#v}" -lt 32 ]; then
  set_val LICENSE_PEPPER "$(b64n 48)"; fix LICENSE_PEPPER "长度 ${#v} < 32"
else keep LICENSE_PEPPER; fi

v=$(get_val DATA_KEY)
if is_placeholder "$v"; then
  set_val DATA_KEY "$(b64n 32)"; fix DATA_KEY "占位符或示例值（长度 ${#v}）"
elif ! data_key_ok "$v"; then
  set_val DATA_KEY "$(b64n 32)"; fix DATA_KEY "解码非 32 字节（长度 ${#v}）"
else keep DATA_KEY; fi

v=$(get_val BOOTSTRAP_ADMIN_PASSWORD)
if is_placeholder "$v" || [ "${#v}" -lt 12 ]; then
  set_val BOOTSTRAP_ADMIN_PASSWORD "$(hexn 16)"
  fix BOOTSTRAP_ADMIN_PASSWORD "占位符 / 示例口令 / 长度 < 12"
else
  keep BOOTSTRAP_ADMIN_PASSWORD
fi

v=$(get_val BOOTSTRAP_ADMIN_EMAIL)
if [ -z "$v" ]; then
  set_val BOOTSTRAP_ADMIN_EMAIL "admin@example.com"
  gen BOOTSTRAP_ADMIN_EMAIL
else
  keep BOOTSTRAP_ADMIN_EMAIL
fi

# ---------- 3. 数据库口令同步（改了才做，幂等）----------
sync_pg_password() {
  local user db pw
  user=$(get_val POSTGRES_USER); user=${user:-licensehub}
  db=$(get_val POSTGRES_DB);     db=${db:-licensehub}
  pw=$(get_val POSTGRES_PASSWORD)
  if ! command -v docker >/dev/null 2>&1; then
    say "⚠ 本机没有 docker，跳过数据库口令同步（若 api 仍报 password authentication failed，改完 .env 后在部署机执行）"
    return 0
  fi
  if ! docker compose ps --status running 2>/dev/null | grep -q postgres; then
    say "ℹ postgres 未在运行，跳过口令同步（首次部署时数据卷会直接用新口令初始化）"
    return 0
  fi
  if docker compose exec -T postgres psql -U "$user" -d "$db" \
      -c "ALTER USER \"$user\" WITH PASSWORD '$pw';" >/dev/null 2>&1; then
    say "✅ 已把数据库口令同步为 .env 中的 POSTGRES_PASSWORD"
  else
    say "⚠ 数据库口令同步失败 —— 手动执行："
    say "   docker compose exec -T postgres psql -U $user -d $db -c \"ALTER USER \\\"$user\\\" WITH PASSWORD '\$POSTGRES_PASSWORD';\""
  fi
}

if [ "$pg_password_changed" -eq 1 ]; then
  sync_pg_password
fi

# ---------- 4. 输出 ----------
say ""
say "== .env 校验结果 =="
printf '%s\n' "${summary[@]}"
say ""
say "初始管理员邮箱: $(get_val BOOTSTRAP_ADMIN_EMAIL)"
say "初始管理员密码: 查看 .env 中的 BOOTSTRAP_ADMIN_PASSWORD（首次启动后请改密并开启双因素）"
say ""
say "下一步："
say "  docker compose up -d --force-recreate     # 注意：必须 up -d，restart 不刷新环境变量"
say "  docker compose logs --since 5m api | grep -E '已启动|已创建初始管理员|Error'"
