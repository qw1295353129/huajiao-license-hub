# LicenseHub - 常用命令
.PHONY: help install dev dev-api dev-web build typecheck test db-generate db-migrate db-seed seed clean

help:
	@echo "make install      安装依赖"
	@echo "make dev          同时启动 api + web"
	@echo "make dev-api      仅启动后端 (http://localhost:3000)"
	@echo "make dev-web      仅启动前端 (http://localhost:5173)"
	@echo "make build        构建全部"
	@echo "make typecheck    类型检查"
	@echo "make test         运行测试"
	@echo "make db-generate  生成 SQL 迁移"
	@echo "make db-migrate   执行迁移"
	@echo "make db-seed      写入演示数据"

install:
	pnpm install

dev:
	pnpm dev

dev-api:
	pnpm dev:api

dev-web:
	pnpm dev:web

build:
	pnpm build

typecheck:
	pnpm typecheck

test:
	pnpm test

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-seed:
	pnpm db:seed
