# EDM 邮件模板预览与管理系统 · 项目规划（本地 PG 版）

> 本版已移除 Supabase 依赖，改为直接使用本机已有的 PostgreSQL 16。Auth、Realtime、Storage 分别用 Auth.js、PG `LISTEN/NOTIFY` + WebSocket 网关、本地文件系统替代。资源评估见「八、技术栈与部署资源」。

## 一、项目目标

构建一个 EDM 邮件模板预览网站，核心能力包括：

1. AI agent 通过 API 实时推送邮件模板，浏览器即时渲染更新，形成「提交 → 预览 → 再调整」的快速迭代闭环。
2. 将满意的模板版本显式保存为资产，与实时迭代内容区分开。
3. 按「团队 → 项目 → 模板 → 版本」四层结构管理不同用途、不同项目的 EDM 模板。
4. 支持团队多人协作，在「团队 → 项目」两级做细粒度权限管理（谁能看、谁能改、谁能管理成员）。

## 二、核心设计决策

- **渲染隔离**：邮件 HTML 在 sandbox iframe 中通过 `srcdoc` 渲染，避免页面自身样式与模板样式互相污染；模板保持表格布局 + 内联样式的邮件兼容写法。
- **实时通道（自建，替代 Supabase Realtime）**：`edm.versions` 表上挂触发器，INSERT/UPDATE/DELETE 时 `pg_notify('edm.version_events', ...)`，payload 只带 id（避开 8000 字节限制）。一个轻量 WebSocket 网关（Node）用专用连接 `LISTEN` 该频道，按项目订阅转发给浏览器；**每次转发前在 SQL 层重新复核成员资格**。lint、截图等任务状态通过 `edm.version_jobs` 变更触发 `edm.task_events` 频道补充推送。网关与 Next.js 同进程部署（自定义 server），免去额外跨进程消息总线。
- **版本不可变**：每次 agent 提交生成一个不可变版本并全量留档；「实时预览」即最新版本，「已保存」是显式的采纳动作，二者通过版本状态区分。
- **资产闭环**：支持对任意历史版本 diff、回滚、并排对比，保证迭代可追溯、可恢复。
- **邮件兼容性检查**：提交时自动 lint（外链样式、flex/grid、未内联 class、超宽图片等），在预览界面标黄标红，帮助 agent 感知问题。
- **安全优先**：数据库是权限的最后防线。所有业务表启用 RLS；服务端以受限角色 `edm_app` 执行业务查询，通过事务级 `SET LOCAL edm.current_user_id` 注入当前用户身份，RLS 策略据此判定成员与角色。API key 路径以 `edm.api_key_*` 上下文变量注入，由 RLS 兜底校验。

## 三、数据模型

数据库使用两个 schema：

- `auth`：身份与会话，由 Auth.js（NextAuth v5）Postgres adapter 管理（users、sessions）。业务代码不直接读写这些表。
- `edm`：全部业务表，启用 RLS。

主键使用 `bigint generated always as identity`；外键列一律建索引。数据库角色：`edm_migrator`（拥有 schema，仅迁移用）、`edm_app`（业务读写，RLS 生效，search_path=edm,public）、`edm_service`（后台任务，bypassrls，仅服务端使用）。

### 身份与会话（auth schema）

- `users`：id（uuid，`gen_random_uuid()`）、email（citext，唯一）、password_hash（argon2id，只存哈希）、created_at、updated_at。
- `sessions`（会话）：Auth.js Postgres adapter 标准结构；纯邮箱 + 密码登录，不需要 OAuth 绑定表。
- 授权信息（角色等）只存在于 `edm.project_members`，绝不放进任何用户可编辑的元数据字段。

### Team（团队）

最外层隔离单元与权限边界。

- id、name、description
- ownerId → auth.users(id)
- createdAt、updatedAt

### TeamMember（团队成员）

用户与团队的多对多关系，团队角色按映射继承到团队内所有项目。

- teamId → teams(id)、userId → auth.users(id)、role（owner / admin / member）
- addedBy、joinedAt
- `unique(teamId, userId)`；teamId、userId 均建索引

### Project（项目）

属于某个团队（个人项目可不挂团队）。

- id、name、description
- teamId → teams(id)（可空）
- ownerId → auth.users(id)
- agentCanApprove（boolean，默认 true，控制 agent 可否直接采纳为 saved）
- createdAt、updatedAt

### ProjectMember（项目成员）

用户与项目的多对多关系，携带角色。

- projectId → projects(id)、userId → auth.users(id)、role（admin / member）
- invitedBy、joinedAt
- `unique(projectId, userId)`；projectId、userId 均建索引

### Template（模板）

代表一个具体用途的邮件，如「双11活动邮件」「注册欢迎信」「支付成功通知」。

- id、projectId → projects(id)
- name、purpose（用途描述）、tags（text[]）
- status（active / archived）
- createdBy、createdAt、updatedAt

### Version（版本）

每次提交产生的不可变快照，是实时迭代和保存动作的基本单位。

- id、templateId → templates(id)
- html、source（原始 MJML 或 HTML）
- note（提交说明）
- status（draft / saved）
- lintReport（jsonb）
- screenshotPath（本地存储相对路径，桌面/移动两张）
- createdBy（用户或为空表示 agent）、sourceApiKeyId（若来自 API 提交）
- createdAt

### ProjectApiKey（项目 API key）

供 agent 使用的服务凭证，与用户账号解耦。

- id、projectId → projects(id)
- name、keyHash（SHA-256，只存哈希，明文仅在创建时展示一次）
- role（固定为 agent，或按需扩展权限位）
- createdBy、lastUsedAt、revokedAt
- keyHash 建唯一索引

### VersionJob（任务状态，替代 Realtime Broadcast 的持久层）

- id、versionId → versions(id)
- kind（lint / screenshot）、status（pending / running / done / failed）
- result（jsonb）、startedAt、finishedAt
- 变更触发器 `pg_notify('edm.task_events', ...)`

### AuditLog（操作审计，M2）

记录成员变更、权限调整、保存/回滚等关键操作，支持多人协作追溯。

- id、projectId、actorId（可为空表示系统）、action、entityType、entityId、payload（jsonb）、createdAt

## 四、权限模型

### 角色矩阵（项目级）

| 能力 | admin（管理员） | member（非管理员） | agent（API key） |
| --- | --- | --- | --- |
| 查看项目 / 主题 / 模板 | ✅ | ✅ | ✅ |
| 创建与编辑主题 / 模板 / 图片 | ✅ | ✅ | ❌ |
| 提交 / 采纳 / 回滚版本 | ✅ | ✅ | ✅（回滚仅限人工） |
| 删除主题 / 模板 / 图片 | ✅ | ❌ | 仅自己上传的图片 |
| 邀请新用户、分配项目、管理成员 | ✅ | ❌ | ❌ |
| 管理 API key 与项目设置 | ✅ | ❌ | ❌ |
| 删除项目 | 仅项目创建者（owner_id） | ❌ | ❌ |

角色只有两级：**管理员（admin）** 与 **非管理员（member）**。管理员可邀请新用户并分配项目；
非管理员对所在项目拥有编辑与查看权限，但不能管理用户/成员。项目创建者以 `projects.owner_id`
记录，权限等同管理员，并保留「仅创建者可删除项目」的兜底约束。agent 可以推送版本、读取结果，
并可**直接采纳为 saved**（项目级开关 `projects.agent_can_approve`，默认开启）。

### 团队角色继承（团队 → 项目）

- team member → 团队内所有项目 member；team admin → admin；team owner → 项目创建者级权限。
- 用户同时有直接项目角色和团队继承角色时，取两者中最高权限。
- 团队 owner/admin 可管理团队成员；团队 admin 对团队内项目拥有 admin 级管理权（含成员与 API key）；团队 owner 可删除团队。

### RLS 设计与上下文变量

- 所有业务表 `enable row level security`，并向 `edm_app` 显式 `grant select, insert, update, delete`；`edm_service` 仅服务端内部使用，绝不暴露给网络入口。
- 服务端在每个请求的事务中通过 `SET LOCAL` 注入身份上下文，RLS 策略只信任这些会话变量：
  - `edm.current_user_id`（当前登录用户 uuid）
  - `edm.api_key_project_id`（agent 请求校验通过后的项目 id）
  - `edm.api_key_valid`（`'true'` / `'false'`）
- 成员资格判定收敛为一个 `security invoker` 辅助函数 `edm.is_member(p_project bigint, p_min_role text)`：内部读取 `current_setting('edm.current_user_id', true)`，同时查 `project_members`（直接角色）与 `team_members`（继承角色）并取最高，不引入 `security definer` 绕过 RLS。
- agent 写入策略同时要求：`edm.api_key_valid = 'true'` 且 `edm.api_key_project_id` 与行所属项目一致，且 `status = 'saved'` 时项目必须开启 `agent_can_approve`（RLS 读取 projects 行校验）——即使应用层被绕过，数据库层也不允许越过开关产生 saved 版本。
- 每个 `for update` policy 同时写 `using` 和 `with check`，防止把行改写到无权访问的范围。
- 查询性能上，把当前用户 id 包在子查询里缓存，避免逐行函数调用；policy 涉及的项目成员列确保有索引。
- 截图等文件放本地私有存储目录，不暴露为静态目录，只通过鉴权 API 读取。

### Agent 访问路径

1. agent 携带 `Authorization: Bearer edm_<key>` 调用服务端 API；
2. 服务端以 `edm_service` 角色查 keyHash、校验未撤销，解析出项目和角色；
3. 在同一事务内 `SET LOCAL edm.api_key_project_id` / `edm.api_key_valid` 后用 `edm_app` 角色写入，RLS 兜底校验；
4. `sourceApiKeyId` 记录来源。

## 五、关键流程

### 实时迭代闭环

```
agent POST 新版本（带 API key）
  → 服务端校验 → 写入版本 + 创建 VersionJob
  → 触发器 pg_notify('edm.version_events')
  → WS 网关按项目转发（转发前 SQL 复核成员资格）
  → 浏览器自动切换预览到最新版本
  → lint/截图完成更新 job → pg_notify('edm.task_events') → 网关补充推送
  → agent 观察结果 / 用户比对后继续迭代
```

### 保存满意模板

1. agent 迭代出满意版本；
2. 项目成员（member 及以上），或允许采纳的 agent（项目开关，默认开启）执行「采纳/保存」；
3. 版本状态置为 saved，进入模板的「已保存版本」分组；
4. 之后可随时回滚到任意已保存版本。

### 邀请协作

1. owner/admin 在后台为对方预建账号（邮箱 + 初始密码）并线下告知；
2. 对方通过邮箱 + 密码登录，首次登录强制修改密码；
3. 建立 ProjectMember（项目级精确授权）或 TeamMember（团队级继承）行并授予角色，RLS 立即生效；
4. 移除成员或改角色后，其数据访问与 WS 订阅同步收敛（网关收到后断开或过滤）。

### 团队管理

1. 团队 owner 创建团队，预建成员账号并授予团队角色；
2. 团队内项目可选择挂在该团队下，团队成员按映射获得权限；
3. 需要更细控制时，在项目级再单独设置角色。

## 六、API 设计

### 认证

- Auth.js v5：邮箱 + 密码（Credentials provider，密码用 argon2id 只存哈希）；会话为 httpOnly cookie。
- 路由：`/api/auth/*`、`/api/auth/session`。
- 不依赖 SMTP。注册采用邀请制：管理员预建账号并下发初始密码，首次登录强制修改密码；系统不提供公开注册入口。

### 团队管理

- `POST /api/teams` 创建团队（创建者自动成为 owner）
- `GET /api/teams` 团队列表
- `POST /api/teams/:teamId/members` 预建账号并加入团队
- `GET/PATCH/DELETE /api/teams/:teamId/members/:userId` 团队成员与角色管理

### 实时

- `GET /ws?projectId=`：携带会话 cookie 建立连接；网关验证会话、校验成员资格后订阅该项目，只下发有权限事件。
- 频道：`edm.version_events`（版本变更）、`edm.task_events`（lint/截图状态）。

### 文件

- `GET /api/versions/:versionId/screenshots/:kind`（desktop / mobile）：服务端校验项目成员资格后，从本地存储目录读取并返回。

### 项目管理

- `POST /api/projects` 创建项目（创建者自动成为 owner，可挂到团队下）
- `GET /api/projects` 项目列表
- `PATCH /api/projects/:projectId` 更新项目信息
- `POST /api/projects/:projectId/members` 预建账号（邮箱 + 初始密码）并加入项目
- `GET/PATCH/DELETE /api/projects/:projectId/members/:userId` 成员与角色管理

### 模板管理

- `POST /api/projects/:projectId/templates` 创建模板
- `GET /api/projects/:projectId/templates?tag=&q=&status=` 模板列表（支持筛选）
- `PATCH /api/templates/:templateId` 更新名称、用途、标签
- `POST /api/templates/:templateId/move` 项目间移动/复制

### 版本提交与保存

- `POST /api/templates/:templateId/versions` agent 推送入口
- `GET /api/templates/:templateId/versions` 版本历史
- `POST /api/templates/:templateId/versions/:versionId/approve` 保存为满意模板
- `POST /api/templates/:templateId/versions/:versionId/rollback` 回滚

### API key 与元数据

- `POST/GET/DELETE /api/projects/:projectId/api-keys` API key 管理（明文仅返回一次）
- `GET /openapi.json` OpenAPI 描述，供 agent 自动发现接口
- 可选：MCP 工具端，让 Codex 等 agent 以原生工具形式操作

## 七、界面布局

- **左侧栏**：团队/项目两级切换、新建项目入口。
- **模板列表页**：卡片网格，展示缩略图、用途标签、最近更新时间，支持按标签/用途/关键词筛选。
- **模板详情页**：
  - 左侧大画布：实时预览，支持桌面/移动端切换；
  - 右侧版本时间线：类似 Figma 历史，区分 draft / saved，支持并排 diff 与回滚；
  - 「实时模式」入口：agent 推送时专注观察画布；
  - 协作状态：显示谁最近编辑、谁正在查看。
- **项目设置页**：成员列表与角色管理、添加成员、API key 管理、审计日志。
- **团队设置页**：团队成员与角色管理、成员从团队到项目的继承说明。
- **分享**：已保存模板生成只读分享链接，供业务/设计同事查看。

## 八、技术栈与部署资源

- **应用框架**：Next.js（App Router）+ Auth.js v5 + Drizzle ORM + node-postgres（pg）
- **数据库**：本机已有 PostgreSQL 16（5432）——RLS、LISTEN/NOTIFY、触发器
- **实时**：ws（Node WebSocket 网关，与 Next.js 同进程部署）
- **存储**：本地文件系统，`EDM_STORAGE_DIR=/var/lib/edm/storage`
- **截图**：Playwright（headless，并发固定为 1）
- **迁移**：drizzle-kit 生成 SQL 迁移，psql 应用
- **后台任务**：MVP 用进程内队列（lint/截图并发 1）；将来多实例部署再换 graphile-worker（纯 PG 队列，不引入 Redis）

### 部署形态与资源评估

- 部署：`next build && next start`（生产 standalone，不常驻 dev server）。
- 内存增量估算：Next.js 250–400 Mi + headless Chromium 350–600 Mi（并发 1）+ WS 网关并入同进程 ≈ **0.7–1.3 Gi**。本机当前可用约 4.9 Gi，余量充足；但 swap 已使用约 926 Mi，务必保持截图并发为 1、避免多个 dev server 常驻。
- CPU：2 核在低并发内部工具场景下足够；峰值仅出现在 `next build` 与截图瞬间。
- 磁盘：29 Gi 可用；依赖与 Chromium 约 1–2 Gi，单张截图 100–500 KiB，长期使用无压力。
- 备份：`pg_dump` + 存储目录 rsync（可挂 cron）。

## 九、里程碑

### M1：可用 MVP

- Auth.js 邮箱 + 密码登录 + 团队/项目两级成员与角色 + 全量 RLS
- 团队/项目/模板/版本 CRUD + 模板筛选
- 项目级 API key + agent POST 即渲染 + LISTEN/NOTIFY + WS 实时刷新
- 保存为满意模板（draft / saved，agent 可直接采纳，项目级开关）、版本时间线、基础 diff

### M2：体验完善

- 添加成员流程、成员在线状态、审计日志
- 截图缩略图、并排对比、回滚
- 邮件兼容性 lint 报告、MJML 编译支持
- 只读分享链接

### M3：生态集成

- MCP 工具端 / OpenAPI 完善
- ESP（Brevo、SendGrid 等）推送集成
- 已保存模板导出 ZIP

## 十、安全清单（实现时逐项落实）

- 所有业务表启用 RLS，并仅对 `edm_app` 显式授权；`edm_service` 凭据只出现在服务端。
- 当前用户身份只经 `SET LOCAL edm.current_user_id` 注入；所有查询参数化，禁止拼接。
- 角色判定只来自 `edm.project_members` 与 `edm.team_members`（取最高）；用户可编辑的字段一律不参与鉴权。
- `for update` policy 同时提供 `using` 与 `with check`。
- agent 写入 `status` 受项目 `agent_can_approve` 开关约束（draft / saved），且 `api_key_valid` / `api_key_project_id` 由 RLS 复核；API key 只存哈希。
- WS 握手校验会话 cookie，每个事件转发前按项目重新复核成员资格；成员被移除后立即断开/过滤订阅。
- 截图等文件只走鉴权 API 读取，绝不放入公开静态目录。
- 视图使用 `security_invoker`（PG 15+），避免默认绕过 RLS。
- 会话 cookie 设置 httpOnly / secure / sameSite。

## 十一、已确认决策

- agent 可以直接采纳版本为 saved：项目级开关 `projects.agent_can_approve`，默认开启；回滚仍仅限人工。
- MVP 包含团队层级：团队 → 项目 → 模板 → 版本；团队成员角色按映射继承到团队内所有项目，直接项目角色与继承角色取最高。
- WS 网关与 Next.js 同进程部署（自定义 server），不拆独立进程。
