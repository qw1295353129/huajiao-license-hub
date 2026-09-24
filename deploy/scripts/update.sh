#!/usr/bin/env bash
# 在服务器上更新 LicenseHub：拉取最新代码 → 重建镜像 → 重启 → 打印状态
#
#   用法：bash deploy/scripts/update.sh
#
# 说明：
#   - deploy/.env 是 gitignored，pull 不会覆盖它；脚本会先留一份备份。
#   - 只重建 api / web 两个应用镜像；postgres / redis 数据卷不受影响，不会删数据。
#   - 服务器上的目录必须是本仓库的 git clone（非 git 目录请见脚本末尾提示）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if ! command -v git >/dev/null 2>&1 || [ ! -d .git ]; then
  cat <<'EOF'
✖ 当前目录不是 git 仓库（或服务器没装 git）。
  两个办法：
  1) 装 git 后重新克隆一份，把 deploy/.env 拷过去：
       apt-get update && apt-get install -y git        # Debian/Ubuntu
       git clone https://github.com/qw1295353129/huajiao-license-hub.git license-hub
  2) 从本机推送代码（本机执行）：
       rsync -av --exclude node_modules --exclude .data --exclude deploy/.env \
         /Users/l21/Documents/license-hub/ 用户@服务器:/服务器上的/license-hub/
     然后在服务器上执行：cd /服务器上的/license-hub/deploy && docker compose up -d --build
EOF
  exit 1
fi

if [ ! -f deploy/.env ]; then
  echo "✖ 找不到 deploy/.env（生产环境变量）。先 cp deploy/.env.example deploy/.env 并填好各项。"
  exit 1
fi

echo "==> 更新前版本：$(git rev-parse --short HEAD)  ($(git log -1 --format=%cd --date=short))"
echo "==> 备份 deploy/.env → deploy/.env.bak.$(date +%Y%m%d%H%M%S)"
cp deploy/.env "deploy/.env.bak.$(date +%Y%m%d%H%M%S)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠️  仓库里有未提交的本地改动，pull 可能被拒绝。"
  echo "    确认这些改动可以丢弃后执行：git stash --include-untracked  然后重新跑本脚本。"
  echo "    （deploy/.env 不在其中，它是被 git 忽略的）"
  exit 1
fi

echo "==> git pull --ff-only"
git pull --ff-only
echo "==> 更新后版本：$(git rev-parse --short HEAD)"

cd deploy
echo "==> 重建 api / web 镜像"
docker compose build api web

echo "==> 重启服务（数据卷保留）"
docker compose up -d

echo "==> 等待 api 健康检查（最多 90 秒）"
for _ in $(seq 1 30); do
  if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q '^api .*healthy'; then
    echo "    api 已健康 ✔"
    break
  fi
  sleep 3
done

echo
echo "==> 当前容器状态"
docker compose ps
echo
echo "==> api 最近 30 行日志"
docker compose logs --tail=30 api
echo
echo "日志里看到「LicenseHub API 已启动」即为成功。"
echo "登录不进去时：docker compose exec api node dist/db/admin-cli.js list / unlock / reset --email <邮箱>"
