# EDM 前端设计契约 v2（供 kimi code 实现）

本文件是前端实现的唯一事实来源。后端已按「项目 → 主题 → 模板 → 版本」四层
（权限与内容管理三层：项目-主题-模板）重构并验证通过，前端需按本契约适配。

## 0. 技术栈与工程约束

- Next.js 15.5 App Router + React 19 + TypeScript（strict）
- Tailwind CSS v4（已配好）；路径别名 `@/*` → `src/*`
- 服务端组件负责登录态守卫；交互组件 `"use client"`
- 共享类型 `src/lib/types.ts`、浏览器 API 客户端 `src/lib/client-api.ts`
  （**本轮已更新，直接使用 `api.*`**）
- WS 地址：默认同源 `/ws`（Caddy 反代到 WS 网关）；本地开发用 `.env.development`
  的 `NEXT_PUBLIC_WS_URL`
- **禁止运行 `next dev` / `next build`**（生产 systemd 服务正在运行，二者会互相
  覆盖 `.next`）。自查只用 `npx tsc --noEmit`；构建与联调由主控方完成

## 1. 数据模型（三层）

项目(Project) → 主题(Topic) → 模板(Template)，模板下是不可变版本(Version)。

- `Topic`：id、projectId、name、purpose、createdBy、createdAt、updatedAt、templateCount
- `TemplateSummary` 新增：topicId、projectId、topicName
- 权限是项目级：管理员（admin）/ 非管理员（member）；成员邀请 = **选定项目 + 角色 + 初始密码**

## 2. 路由与页面

| 路由 | 页面 |
| --- | --- |
| /login | 登录 |
| /change-password | 修改密码（首次登录强制 + 侧栏主动入口共用此页） |
| / | 首页重定向 |
| /templates?projectId= | 模板列表（按主题分组/筛选） |
| /templates/[templateId] | 模板详情（预览 + 版本时间线 + 实时模式） |
| /projects/[projectId]/settings | 项目设置（通用/主题/API key） |
| /users | 全局用户管理（独立于项目） |

全站左侧栏（`src/components/sidebar.tsx`，本轮严格重做）：

- **最顶端：项目切换下拉框**。项目即最顶层 Workspace：显示当前项目名 + 角色徽标，
  点击展开列出所有可访问项目（名称 + 角色徽标，当前项高亮），底部「＋ 新建项目」
  唤起新建弹窗；切换项目后跳转 `/templates?projectId=<id>`（重置主题上下文）。
- 项目下方三段功能导航（未选项目时显示「请先选择项目」占位）：
  1. **主题**：可折叠分组（默认展开）。头部整行点击折叠/展开；展开后依次为
     「全部模板」（`/templates?projectId=`）和各主题（`/templates?projectId=&topicId=`），
     当前主题高亮并显示模板数；无主题显示「暂无主题」。
  2. **设置**：跳转 `/projects/{projectId}/settings`（用户、API 客户端等已合并进
     设置页的 tab）。在设置页任意 tab 下该项高亮。
- 底部：用户信息 + 「用户管理」入口（→ `/users`，替换原「修改密码」）+ 退出登录。

设置页 `settings/page.tsx` 需支持 `?tab=` 深链（general/topics/members/apikeys/audit），
使侧栏「API 客户端」「用户」能直达对应 tab；无效或缺省时回退 general。

## 3. 页面细节

### 3.1 模板列表

- 顶部：主题选择改由左侧栏承担；本页保留「+ 主题」「+ 新建模板」按钮（操作当前选中
  主题）。**无搜索框、无标签筛选、无状态筛选**
- 模板卡片：与 v1 相同（截图缩略图、名称、用途、标签、最新版本时间、draft/saved 徽标、
  lint 圆点），并显示所属主题名
- 「新建模板」弹窗必须含**主题下拉选择**（默认当前选中的主题）；「新建主题」弹窗：
  名称 + 用途
- 空主题时提示「先创建主题」；空态引导完整

### 3.2 模板详情

- 与 v1 相同（iframe 预览、desktop/mobile、缩放、lint 条、版本时间线、采纳/回滚/diff、
  HTML 编辑提交、WS 实时）
- 顶部增加面包屑：项目 / 主题 / 模板；「移动到」操作改为**选择目标主题**（可跨项目，
  复制可选）
- 顶部工具条加「复制代码」按钮：复制代码面板当前内容（含未提交编辑；无选中版本时
  禁用），成功后短暂显示「已复制」反馈
- 预览支持鼠标悬停高亮、点击选中 DOM 节点；右侧面板含「代码 / 版本」两个标签页，
  选中节点后自动切到「代码」页并选中对应源码区间；「代码」页可直接编辑 HTML（打开
  自动美化缩进，CodeMirror 语法高亮编辑，「格式化」按钮可重新美化），修改后
  「提交新版本」生成新版本，编辑内容实时同步预览（防抖）；渲染区与右侧面板之间可用
  鼠标拖拽分隔条调整宽度（宽度本地记忆）；选中文字节点后**双击**直接进入原地编辑
  （光标停在双击处、支持部分增减，Enter 提交/Esc 取消），或通过工具条「编辑文案」
  进入（光标在末尾）；选中图片可直接换 src（粘贴 URL、从项目图库选择或上传新图），
  选中超链接可直接改 href（纯文本链接还可改文案）；定位映射会跳过注释内的标签，
  避免改到错误的节点导致样式丢失

### 3.3 项目设置

- 通用设置 tab：名称/描述、agentCanApprove 开关
- **新增「主题」tab**：主题列表（名称、用途、模板数、编辑/删除，删除需二次确认）；
  「+ 新建主题」
- API key tab：与 v1 相同（审计日志功能已移除）

**成员管理已从项目设置中抽离**：项目设置不再有「成员」tab。

### 3.4 修改密码

- 侧栏不再有「修改密码」入口；改密入口放在 `/users` 页（「修改我的密码」按钮）。
  首次登录（mustChangePassword）仍由布局守卫强制跳转 /change-password；改密成功后
  退出登录并回 /login

### 3.5 全局用户管理（/users）

- 独立于项目：任何项目管理员（至少一个项目）可访问；无权限时展示「无权限」提示
- 用户列表：邮箱、姓名、创建时间、成员资格 chips（项目名 + 角色，可移除，二次确认）
- 每用户「添加项目」：项目下拉（仅列出我管理员的项目）+ 角色下拉（管理员 / 成员）
- 「邀请用户」弹窗：邮箱、姓名(可选)、初始密码(≥8)、**项目分配**（至少一行
  「项目 + 角色」，可增删多行，支持一次分配到多个项目）
- 每用户「删除账号」：危险操作，二次确认后调 `api.users.remove`；后端错误
  （如「不能删除自己」「该用户是项目创建者」）原样展示
- 顶部「修改我的密码」按钮 → /change-password

## 4. API 契约（全部已封装在 client-api.ts）

- `api.projects.list/create/get/update/remove`（create 不再有 teamId）
- `api.topics.list(projectId)/create(projectId, {name,purpose})/get/update/remove`
- `api.templates.list(projectId, {topicId?,tag?,q?,status?})`
- `api.templates.create(topicId, {name,purpose,tags,html?,source?,note?})`
- `api.templates.move(templateId, topicId, copy?)`
- `api.projects.addMember(projectId, {email, role, name?, password})`
- `api.users.list/create/upsertMembership/removeMembership`（全局用户管理）
- `api.users.remove(userId)`（删除账号）
- 版本/截图/API key/审计接口与 v1 相同；非 2xx 统一 `{ "error": "中文消息" }`

## 5. 验收标准

1. 登录后可看到项目列表；进入项目可按主题切换/筛选模板；可创建/重命名/删除主题
2. 新建模板必须选择主题；详情页有 项目/主题/模板 面包屑；可跨主题移动/复制
3. 添加成员必须填写项目内角色与初始密码（≥8 位），错误有中文提示
4. 侧栏有「修改密码」入口，改密后回到登录页
5. `npx tsc --noEmit` 零错误（不要跑 build/dev）

## 6. 文件约定

- 已存在的页面与组件就地修改；主题相关组件可新建于 `src/components/`
- 保持 `src/lib/client-api.ts`、`src/lib/types.ts` 不变（确需扩展请向后兼容并说明）
- 不得改动 `src/app/api/**`、`src/db/**`、`src/ws/**`、`src/lib/queue.ts`、
  `src/lib/lint.ts`、`src/lib/storage.ts`、`src/lib/api-keys.ts`、`src/instrumentation.ts`、
  `migrations/**`
