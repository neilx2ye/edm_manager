# EDM 邮件模板预览与管理系统

按 `PROJECT_PLAN.md` 实现的本地 PostgreSQL 版（已按最新需求调整为
项目 → 主题 → 模板 → 版本 四层结构，权限与内容管理收敛为项目-主题-模板三层），
AI agent 通过 API key 实时推送版本，浏览器经 WebSocket（LISTEN/NOTIFY）即时刷新预览，
支持采纳（saved）、回滚、diff、邮件兼容性 lint 与 Playwright 截图。

## 快速开始

```bash
# 1. 初始化数据库角色与 edm 库（需要 sudo）
bash scripts/setup-db.sh

# 2. 应用迁移
bash scripts/migrate.sh

# 3. 种子数据（演示账号 admin@edm.local / admin123456）
npm run db:seed

# 4. 启动（应用 3000，WebSocket 网关 3001，lint/截图任务随进程启动）
npm run dev        # 开发
npm run build && npm run start   # 生产
```

## 测试

```bash
npx tsx --env-file=.env scripts/smoke.ts      # 登录 + API key + agent 推送
npx tsx --env-file=.env scripts/ws-smoke.ts   # WebSocket 实时链路
npx tsx --env-file=.env scripts/flow-test.ts  # agent_can_approve 开关与回滚
npx tsx --env-file=.env scripts/perm-test.ts  # viewer 角色矩阵
npx tsx --env-file=.env scripts/agent-discovery.ts # agent 只读发现主题/模板
npx tsx --env-file=.env scripts/model-test.ts # 项目→主题→模板三层流程与邀请改密
npx tsx --env-file=.env scripts/ui-smoke.mts  # 生产构建 UI 冒烟（Playwright）
```

## 关键环境变量（.env）

- `DATABASE_URL`：迁移角色 edm_migrator
- `EDM_APP_DATABASE_URL`：业务角色 edm_app（RLS 生效）
- `EDM_SERVICE_DATABASE_URL`：服务角色 edm_service（BYPASSRLS，仅服务端）
- `AUTH_SECRET`：Auth.js JWT 加密密钥
- `EDM_STORAGE_DIR`：截图等本地文件存储
- `WS_PORT`：WebSocket 网关端口（默认 3001）

## Agent 接入

在「项目设置 → API key」创建 key（明文仅展示一次），随后：

线上地址 `https://edm.neilx.online`。agent 可在所属项目内只读发现主题与模板，
先拿到 `templateId`：

```bash
curl -H "Authorization: Bearer edm_<key>" \
  "https://edm.neilx.online/api/projects/<projectId>/topics"

curl -H "Authorization: Bearer edm_<key>" \
  "https://edm.neilx.online/api/projects/<projectId>/templates"
```

再推送新版本：

```bash
curl -X POST "https://edm.neilx.online/api/templates/{templateId}/versions" \
  -H "Authorization: Bearer edm_<key>" \
  -H "Content-Type: application/json" \
  -d '{"html":"<html>...</html>","note":"v2","status":"draft"}'
```

上传图片（PNG / JPEG / WebP / GIF，≤10 MB），返回的 `url` 可直接放进邮件 HTML：

```bash
curl -X POST "https://edm.neilx.online/api/projects/<projectId>/images" \
  -H "Authorization: Bearer edm_<key>" \
  -F "file=@/path/to/hero.png" \
  -F "name=首屏主图"
# → {"id": 42, "url": "/api/images/42", ...}
```

agent 可读取项目图片列表、拉取原图，并删除自己上传的图片；登录用户可在
侧栏「图片库」页面集中管理（上传 / 复制 URL / 删除）。图片 URL 走同源认证：
浏览器内嵌（iframe / `<img>`）使用登录 cookie，agent 直接拉取时带 Bearer key。

接口发现：`GET /openapi.json`（只列 agent 可用的接口）。创建主题/模板仍仅限
登录用户；可直接采纳为 `saved` 的能力由项目开关 `agent_can_approve` 控制
（默认开启），回滚仅限人工。

## 生产部署（Caddy 反向代理 + systemd）

本机用 Caddy 做 80/443 反向代理，`edm.neilx.online` 已配置：

- `/` → 127.0.0.1:3000（Next.js）
- `/ws` → 127.0.0.1:3001（WebSocket 实时网关，同进程）

配置与单元文件在 `deploy/` 目录：

```bash
sudo caddy validate --config deploy/Caddyfile   # 校验
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # 安装（会自动签发 TLS 证书）
sudo systemctl reload caddy

sudo cp deploy/edm.service /etc/systemd/system/edm.service
sudo systemctl daemon-reload && sudo systemctl enable --now edm
```

域名 DNS 需解析到本机公网 IP（`A 124.156.194.176`），Caddy 会在首次访问时
自动签发 Let's Encrypt 证书。前端 WebSocket 默认走同源 `/ws`，本地开发用
`.env.development` 里的 `NEXT_PUBLIC_WS_URL` 指向 3001 端口。

## 架构要点

- 数据库是权限最后防线：所有业务表启用 RLS，服务端以 `SET LOCAL edm.current_user_id`
  / `edm.api_key_*` 注入身份上下文；成员资格由 security definer 的布尔函数判定
  （避免 RLS 递归，见 `migrations/0001_init.sql` 头部说明）
- 成员邀请：在项目设置中选择项目 + 角色 + 初始密码（≥8 位）；密码修改入口在侧栏
- 实时：`edm.versions` / `edm.version_jobs` 触发器 `pg_notify`，同进程 WebSocket
  网关（`src/instrumentation.ts`）LISTEN 并**每次转发前在 SQL 层复核成员资格**
- 后台任务：进程内队列，lint / Playwright 截图并发固定为 1
- 版本不可变：回滚 = 复制历史版本为新版本
