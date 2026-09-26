#!/usr/bin/env bash
# 一键部署 LicenseHub（服务器上第一次安装时用；后续更新用 deploy/scripts/update.sh）
#
#   bash deploy/scripts/install.sh                    # 全自动：随机生成所有密钥与初始管理员口令
#   bash deploy/scripts/install.sh --email me@x.com    # 指定初始管理员邮箱
#   bash deploy/scripts/install.sh --password 'xxx'    # 指定初始管理员口令（不指定则随机生成并打印）
#   bash deploy/scripts/install.sh --origin http://1.2.3.4:8080 [--port 8080]
#   bash deploy/scripts/install.sh --force             # 已存在 .env 时：先备份再重新生成
#
# 做的事：生成 deploy/.env（随机强口令，全部 URL 安全）→ 构建镜像 → 启动 → 等 api 健康
#        → 打印登录地址与初始账号，以及常用运维命令。
# 不会删数据：不动已有数据卷；要重建数据库请显式执行 docker compose down -v。
set -euo pipefail

EMAIL=""
PASSWORD=""
ORIGIN=""
PORT="8080"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:?--email 需要值}"; shift 2 ;;
    --password) PASSWORD="${2:?--password 需要值}"; shift 2 ;;
    --origin) ORIGIN="${2:?--origin 需要值}"; shift 2 ;;
    --port) PORT="${2:?--port 需要值}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$1（用 --help 看用法）"; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------- 前置检查
if ! command -v docker >/dev/null 2>&1; then
  cat <<'EOF'
✖ 没找到 docker。先装 Docker（Debian/Ubuntu）：
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  （宝塔面板：软件商店里装「Docker管理器」，或用上面的官方脚本）
EOF
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "✖ 需要 Docker Compose v2（docker compose 子命令）。升级 Docker 即可自带。"
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "✖ 需要 openssl 生成密钥：apt-get install -y openssl"
  exit 1
fi
if [ ! -f deploy/.env.example ] || [ ! -f deploy/docker-compose.yml ]; then
  echo "✖ 请在仓库根目录运行本脚本（找不到 deploy/.env.example）。"
  exit 1
fi
if printf '%s' "$PASSWORD" | grep -qE '[\$[:space:]]'; then
  echo "✖ 初始管理员口令不能包含 \$ 或空格（写入 .env 会被 Compose 解析）。"
  echo "   建议留空由脚本随机生成，或改用 openssl rand -hex 12 生成的值。"
  exit 1
fi

# ---------------------------------------------------------------- 生成 .env
if [ -f deploy/.env ]; then
  if [ "$FORCE" -ne 1 ]; then
    echo "✖ deploy/.env 已存在，不会覆盖（密钥一旦更换，已发的授权码/密文会失效）。"
    echo "   只想更新代码：bash deploy/scripts/update.sh"
    echo "   确实要重新生成：bash deploy/scripts/install.sh --force（会先备份旧 .env）"
    exit 1
  fi
  BACKUP="deploy/.env.bak.$(date +%Y%m%d%H%M%S)"
  cp deploy/.env "$BACKUP"
  echo "==> 已备份旧配置到 $BACKUP"
fi

# 数据卷残留时重新生成口令会导致 password authentication failed / 502，提前拦一道
if [ "$FORCE" -eq 1 ] && docker volume ls --format '{{.Name}}' 2>/dev/null | grep -qE '(^|_)pgdata$'; then
  echo "⚠ 检测到已有 postgres 数据卷。--force 会生成新的 POSTGRES_PASSWORD，而卷里仍是旧口令，"
  echo "   启动后 api 会报 password authentication failed、前端登录 502。"
  printf '   继续请输 yes（将保留旧数据卷，稍后你需手动 ALTER USER 同步口令）；输 no 退出：'
  read -r ans
  if [ "$ans" != "yes" ]; then
    echo "已取消。全新安装、数据可丢时：cd deploy && docker compose down -v 后再跑本脚本。"
    exit 1
  fi
fi

random_hex() { openssl rand -hex "$1"; }
# base64 里的 + / = 对 .env 无害（不进 URL），但统一转成 URL 安全字符更省心
random_b64() { openssl rand -base64 "$1" | tr -d '\n' | tr '+/' '-_'; }

POSTGRES_PASSWORD="$(random_hex 24)"
REDIS_PASSWORD="$(random_hex 24)"
JWT_SECRET="$(random_b64 48)"
LICENSE_PEPPER="$(random_b64 48)"
DATA_KEY="$(openssl rand -base64 32 | tr -d '\n')"        # 必须是标准 base64 的 32 字节
BOOTSTRAP_ADMIN_EMAIL="${EMAIL:-admin@licensehub.local}"
GENERATED_PASSWORD=0
if [ -z "$PASSWORD" ]; then
  PASSWORD="$(random_hex 12)"
  GENERATED_PASSWORD=1
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
if [ -z "$HOST_IP" ]; then
  HOST_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
fi
ORIGIN="${ORIGIN:-http://${HOST_IP:-localhost}:${PORT}}"

cp deploy/.env.example deploy/.env
# sed 替换前转义替换串里的特殊字符（& | \），避免用户传入的口令被 sed 语法吃掉
sed_escape() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }
sed -i.bak \
  -e "s|^WEB_PORT=.*|WEB_PORT=$(sed_escape "$PORT")|" \
  -e "s|^APP_ORIGIN=.*|APP_ORIGIN=$(sed_escape "$ORIGIN")|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(sed_escape "$POSTGRES_PASSWORD")|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(sed_escape "$REDIS_PASSWORD")|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$(sed_escape "$JWT_SECRET")|" \
  -e "s|^LICENSE_PEPPER=.*|LICENSE_PEPPER=$(sed_escape "$LICENSE_PEPPER")|" \
  -e "s|^DATA_KEY=.*|DATA_KEY=$(sed_escape "$DATA_KEY")|" \
  -e "s|^BOOTSTRAP_ADMIN_EMAIL=.*|BOOTSTRAP_ADMIN_EMAIL=$(sed_escape "$BOOTSTRAP_ADMIN_EMAIL")|" \
  -e "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=$(sed_escape "$PASSWORD")|" \
  deploy/.env
rm -f deploy/.env.bak
chmod 600 deploy/.env
if grep -E '^[A-Z0-9_]+=.*CHANGE_ME' deploy/.env >/dev/null; then
  echo "✖ 生成 .env 后仍残留 CHANGE_ME，请检查 deploy/.env.example 是否被改过。"
  grep -nE '^[A-Z0-9_]+=.*CHANGE_ME' deploy/.env || true
  exit 1
fi
echo "==> 已生成 deploy/.env（所有 CHANGE_ME 已替换为随机值）"

# ---------------------------------------------------------------- 构建与启动
cd deploy
echo "==> 构建镜像（首次约 2–5 分钟）"
docker compose build

echo "==> 启动服务"
docker compose up -d

echo "==> 等待 api 健康检查（最多 120 秒）"
READY=0
for _ in $(seq 1 40); do
  if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q '^api .*healthy'; then
    READY=1
    break
  fi
  sleep 3
done

echo
echo "==> 容器状态"
docker compose ps
echo
if [ "$READY" -eq 1 ]; then
  echo "✅ 部署完成"
else
  echo "⚠️  api 还没变成 healthy，下面是最近日志（通常是 .env 或数据库口令问题）："
  docker compose logs --tail=40 api
  echo
  echo "   诊断命令：docker compose run --rm --no-deps api node dist/db/admin-cli.js doctor"
fi

cat <<EOF

──────────────────────────────────────────────
 管理后台：  ${ORIGIN}/login
 用户门户：  ${ORIGIN}/portal/login
 （若用域名/公网 IP 访问，请把 deploy/.env 的 APP_ORIGIN 改成实际访问地址：仅影响 CORS 与邮件链接）
 初始账号：  ${BOOTSTRAP_ADMIN_EMAIL}
 初始密码：  ${PASSWORD}$([ "$GENERATED_PASSWORD" -eq 1 ] && echo "   ← 随机生成，仅本次显示，请立即保存")
 登录后请立刻改密并开启双因素（设置 → 团队与角色）
──────────────────────────────────────────────
 常用命令：
   更新代码：   bash deploy/scripts/update.sh
   备份数据库： bash deploy/scripts/backup.sh
   账号相关：   docker compose run --rm --no-deps api node dist/db/admin-cli.js list
   重置密码：   docker compose run --rm --no-deps api node dist/db/admin-cli.js reset --email ${BOOTSTRAP_ADMIN_EMAIL}
 注意：以后单独修改 deploy/.env 里的 POSTGRES_PASSWORD，必须同步改数据库里的口令：
   docker compose exec -T postgres psql -U licensehub -d postgres -c "ALTER USER licensehub WITH PASSWORD '新口令';"
EOF
