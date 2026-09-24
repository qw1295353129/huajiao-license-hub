/** 校验 Dockerfile 中引用的路径在仓库里真实存在（本机无 Docker，只能做静态一致性检查） */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let bad = 0;

for (const dockerfile of ['apps/api/Dockerfile', 'apps/web/Dockerfile']) {
  const text = readFileSync(join(root, dockerfile), 'utf8');
  const copies = [...text.matchAll(/^COPY\s+(?:--from=\S+\s+)?(?:--chown=\S+\s+)?(.+)$/gm)];
  console.log('\n' + dockerfile);
  for (const match of copies) {
    const parts = match[1].trim().split(/\s+/);
    const sources = parts.slice(0, -1);
    for (const source of sources) {
      if (source.startsWith('/')) continue; // 来自构建阶段的绝对路径
      const exists = existsSync(join(root, source));
      if (!exists) { bad += 1; console.log('  ❌ 缺失：' + source); }
      else console.log('  ✅ ' + source);
    }
  }
}

// 运行阶段真正要执行的入口文件
const entrypoints = ['apps/api/dist/main.js', 'apps/api/dist/db/migrate-cli.js', 'apps/api/dist/db/seed.js',
  'apps/api/drizzle/meta/_journal.json', 'apps/web/dist/index.html', 'apps/web/nginx.conf'];
console.log('\n运行阶段入口与资源');
for (const file of entrypoints) {
  const exists = existsSync(join(root, file));
  console.log((exists ? '  ✅ ' : '  ❌ ') + file);
  if (!exists) bad += 1;
}

// compose 里声明的服务与命令是否与 Dockerfile 一致
const compose = readFileSync(join(root, 'deploy/docker-compose.yml'), 'utf8');
console.log('\ncompose 关键项');
const checks = [
  ['migrate 服务使用 migrate-cli', compose.includes('dist/db/migrate-cli.js')],
  ['api 服务继承同一环境变量锚点', compose.includes('<<: *api-env')],
  ['api 依赖 migrate 成功完成', compose.includes('service_completed_successfully')],
  ['web 暴露宿主端口变量', compose.includes('${WEB_PORT:-8080}:8080')],
  ['数据库使用命名卷', compose.includes('pgdata:/var/lib/postgresql/data')],
];
for (const [name, ok] of checks) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name);
  if (!ok) bad += 1;
}

console.log('\n' + (bad === 0 ? '🎉 Docker 配置静态一致性检查全部通过' : '❌ 存在 ' + bad + ' 处不一致'));
process.exit(bad === 0 ? 0 : 1);