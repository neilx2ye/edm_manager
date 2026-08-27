# EDM 图片嵌入实现研究

> 目标：让「EDM 邮件模板预览与管理系统」支持把图片嵌入 EDM（邮件）。
> 本文档给出：需求拆解 → 三种嵌入方式的技术原理与客户端兼容性（含来源） →
> 结合本系统现状的推荐架构 → 数据模型 / API / 前端 / 导出管线的具体落地设计。

## 1. 结论速览（TL;DR）

「把图片嵌入 EDM」在邮件语境下有三种实现，兼容性与适用场景完全不同：

| 方式 | 原理 | Gmail | Outlook 桌面 | Apple Mail / iOS | 是否真“随邮件发送” | 推荐度 |
| --- | --- | --- | --- | --- | --- | --- |
| 托管 URL | `<img src="https://...">`，打开邮件时再下载 | ✅（默认经 Google 图片代理缓存） | ✅ | ✅ | ❌（依赖外链服务器） | 主力方案 |
| CID 内联附件 | 图片作为 MIME 附件（`multipart/related`），HTML 用 `cid:` 引用 | ✅ | ✅ | ✅（iOS 只认 CID，不认 base64） | ✅（自包含） | 发送/导出时的“嵌入”方案 |
| Base64 data URI | `<img src="data:image/png;base64,...">` | ❌ 不渲染 | ❌ 被剥离 | ❌ iOS 不支持 | ✅（文本里） | 仅用于浏览器预览，禁止用于投递 |

**推荐组合（针对本系统）**：

1. **第一阶段（素材管理 + 预览）**：新增项目级「图片素材库」——上传、存储、列出、删除；模板 HTML 里引用系统的**同源带鉴权 URL**（`/api/assets/{publicId}`）。因为预览 iframe 是 `srcdoc + allow-same-origin`，同源会话 cookie 会自动带上，图片在预览画布里直接可显示。
2. **第二阶段（真正“嵌入”邮件）**：在导出/发送管线中，把系统素材引用改写为 `cid:{publicId}`，并把图片按 `multipart/related` 组装进 MIME——这样发出的邮件是**自包含**的，收件端不依赖任何公网图片服务器，也不受“默认不加载外部图片”影响。
3. Base64 `data:` URI 只允许在**预览渲染**里做“离线快照”用途，绝不允许进入投递的 HTML。

## 2. 需求拆解

“把图片嵌入到 EDM 里”在本系统里实际包含两段链路：

- **设计/预览链路**：设计师或 agent 往模板里放图片，页面上立刻能看到效果（今天的预览用 `srcdoc` iframe 渲染 `versions.html`）。
- **投递链路**：最终这封邮件被 ESP / SMTP 发出去后，收件人的 Gmail / Outlook / 手机邮箱里图片必须正常显示。

这两条链路对图片的要求不同，是整件事的关键：

- 预览时浏览器可以携带本系统登录会话（cookie），所以**鉴权 URL 可用**；
- 投递后是收件人的客户端去加载图片，**带不走我们的会话 cookie**。所以要么给一个公开可达的 URL（托管方案），要么把图片随邮件一起发过去（CID 嵌入方案）。

## 3. 三种嵌入方式：原理与兼容性证据

### 3.1 托管 URL（外链图片）

HTML 里写绝对地址，收件端在打开邮件时发起 HTTP 请求拉图。这是 Mailchimp、MailPace 等行业产品一致推荐的方式，理由：可缓存、可 CDN、邮件体积小、可在客户端“按需加载”。

- Mailchimp 官方模板指南：「在 HTML 邮件里处理图片的正确方式是把它托管在 web 服务器上，然后在代码里使用绝对路径」。
- MailPace 指南：几乎总是首选 URL/CDN 方式。

**代价与坑**：

- 很多客户端默认**不加载外部图片**（Gmail 有 “Ask before displaying external images” 开关，Apple Mail 有“载入远程内容”开关），首屏可能只有破图占位。
- Gmail 会把外部图片**代理缓存**（Google Image Proxy），好处是发件方服务器不暴露收件人 IP，坏处是个性化/动态图片会失效。
- 图片服务器必须长期可用；停机 = 全量历史邮件图片失效。
- 需要公网域名 + HTTPS（本系统线上域名为 `https://edm.neilx.online`，已具备）。

### 3.2 CID 内联附件（multipart/related，真正的“嵌入”）

把图片作为 MIME 的一个 part 附进邮件，HTML 用 `Content-ID` 引用：

```html
<img src="cid:hero_image_01" width="600" alt="hero" />
```

对应 MIME part：

```text
Content-Type: image/png; name="hero.png"
Content-Transfer-Encoding: base64
Content-Disposition: inline; filename="hero.png"
Content-ID: <hero_image_01>
```

正确结构是 `multipart/related` 包裹 `multipart/alternative`（text/plain + text/html），图片 part 与 HTML 并列放在 related 层（嵌套顺序错会导致 Apple Mail 只显示最后一张图或整封空白）：

```text
multipart/related
├── multipart/alternative
│   ├── text/plain
│   └── text/html          ← <img src="cid:...">
├── image/png (Content-ID: <hero_image_01>)
└── image/jpeg (Content-ID: <product_02>)
```

**优势**：

- 邮件**自包含**：不需要任何公网图片服务器，打开即显示，绕开“默认不加载外部图片”的限制；
- 每张图只附一次，可被 HTML 多处 `cid:` 引用（对比 base64 每处都要复制一遍）；
- Gmail、Thunderbird、Outlook、Apple Mail 均支持；iOS Mail **只支持 CID**、不支持 base64 内联（来源见文末）。

**代价**：

- 邮件体积变大（每张图以 base64 编码进邮件，约 +33% 体积）；
- 收件人转发/存档时行为差异；部分客户端（如旧版 Outlook）可能把它当附件展示。

### 3.3 Base64 data URI（不推荐用于投递）

```html
<img src="data:image/png;base64,iVBORw0KGgo..." />
```

**客户端支持是硬伤**：

- **Gmail 不支持** base64 内联图片（直接不显示）；
- **Outlook 桌面版会剥离** `data:` 图片，OWA 会替换成 1×1 透明 GIF；
- **iOS Mail 不支持** base64 内联，必须 CID。

结论：`data:` URI 在**浏览器里渲染邮件 HTML 没问题**（预览、截图都 OK），但**一旦投递就会在主流客户端大面积丢图**，因此只能作为预览侧手段，禁止写入正式投递的 HTML。

## 4. 本系统现状盘点（影响设计的事实）

- 版本只存 `html` / `source`，图片目前全部依赖模板作者写死的外部 URL，系统没有任何素材/上传能力。
- 预览：`detail.tsx` 用 `<iframe sandbox="allow-same-origin" srcDoc={selected.html}>` 渲染。**关键点**：`srcDoc` 的 iframe 继承父页面 origin，因此 iframe 内的 `<img src="/api/assets/...">` 会携带登录会话 cookie——鉴权图片在预览里天然可用，无需公共 URL。
- 截图管线（`src/lib/queue.ts` 的 `runScreenshot`）用 `page.setContent(html)` 渲染，远程图片要等 `waitForTimeout(600)`；若改用同源素材 URL，Playwright 页面不带 cookie，需在截图时把图片内联为 data URI 或给 Playwright 注入 cookie（见 §7）。
- 存储：本地文件系统 `EDM_STORAGE_DIR=/var/lib/edm/storage`，截图目录 `screenshots/<versionId>/`，读取走鉴权 API（`GET /api/versions/:versionId/screenshots/:kind`）。
- 权限：所有业务表 RLS；身份经 `SET LOCAL edm.current_user_id` / `edm.api_key_*` 注入；成员资格用 `edm.is_member(project_id, min_role)`（security definer，见 `migrations/0001_init.sql` 头部说明）；agent 只读发现主题/模板的模式在 `migrations/0012_agent_discovery.sql`。
- 尚无 SMTP / ESP 发送，也没有导出管线（PROJECT_PLAN.md 的 M3 才规划 ESP 集成与 ZIP 导出）。

## 5. 推荐架构总览

```text
上传（用户 / agent）
  → POST /api/projects/:projectId/assets  (multipart/form-data)
  → 校验魔数 + 大小 + 类型 → 落盘 EDM_STORAGE_DIR/assets/<projectId>/<sha256[:2]>/<sha256>.<ext>
  → 写入 edm.assets（含 publicId、contentType、sha256、宽高等）

引用（模板 HTML）
  → <img src="/api/assets/{publicId}" width="..." alt="...">
  → 预览 iframe（同源 cookie）直接渲染 ✅

投递（导出 / 发送管线）
  → 解析 HTML，把 /api/assets/{publicId} 改写为 cid:{publicId}
  → 组装 multipart/related MIME，图片 part 附 Content-ID
  → 可选：对外托管模式则改写为公开 URL（带不可猜测 token）
```

两个引用模式由**导出时**决定，模板内只保留一种规范引用（系统 URL），不把“是否嵌入”的决策塞进模板 HTML。

## 6. 详细设计

### 6.1 数据模型（新增 `edm.assets`）

归属项目（与 `project_api_keys` 同层），沿用 RLS 三套策略：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | bigint identity | 主键 |
| project_id | bigint → projects | 归属项目 |
| public_id | text unique | 对外引用 ID（不可猜测，如 `nanoid` 22 位 / uuid），URL 与 CID 都用它 |
| filename | text | 原始文件名（仅展示用，落盘名由 sha256 生成） |
| content_type | text | 按魔数检测出的 MIME，只允许 png/jpeg/gif/webp |
| size_bytes | bigint | 体积 |
| sha256 | text | 内容哈希（去重 + 落盘路径） |
| width / height | int | 供插入 `<img>` 时预填尺寸（可选，PNG/JPEG 可解析头） |
| created_by | uuid | 上传者 |
| created_at | timestamptz | |

RLS 策略（模式同 `topics` / `versions`）：

```sql
-- SELECT：viewer 及以上，或所属项目的 agent
CREATE POLICY assets_select ON edm.assets FOR SELECT TO edm_app
  USING (
    edm.is_member(project_id, 'viewer')
    OR (edm.agent_is_valid() AND edm.agent_project_id() = project_id)
  );

-- INSERT：editor 及以上，或所属项目 agent（agent 上传能力可关）
CREATE POLICY assets_insert ON edm.assets FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_member(project_id, 'editor')
    OR (edm.agent_is_valid() AND edm.agent_project_id() = project_id)
  );

-- UPDATE/DELETE：editor 及以上（同 topics 模式，using + with check 双写）
CREATE POLICY assets_delete ON edm.assets FOR DELETE TO edm_app
  USING (edm.is_member(project_id, 'editor'));
```

新建迁移 `migrations/0013_assets.sql`（沿用 `bash scripts/migrate.sh` 机制），并在 `src/db/schema.ts` 补 `assets` 表定义。

### 6.2 存储布局

```text
EDM_STORAGE_DIR/
├── screenshots/<versionId>/{desktop,mobile}.png   # 现状
└── assets/<projectId>/<sha256前2位>/<sha256>.<ext> # 新增
```

- 落盘名**只由 sha256 + 扩展名**决定，杜绝路径穿越（绝不用用户文件名拼路径）；
- 同内容重复上传自动去重（同一 sha256 命中即复用行/文件）；
- 扩展名由检测出的 MIME 映射（png/jpg/gif/webp），不信任上传文件名。

### 6.3 API 设计

沿用 `src/lib/route.ts` 的 `route()` 包装与 `getRequester()` 身份解析：

- `POST /api/projects/{projectId}/assets`
  - `Content-Type: multipart/form-data`，字段 `file`（Blob/File）。
  - 服务端：魔数校验（png `89 50 4E 47`、jpeg `FF D8 FF`、gif `GIF8`、webp `RIFF....WEBP`）→ 大小上限（默认 5 MiB，可配 `EDM_MAX_ASSET_BYTES`）→ 拒绝 SVG（MVP 只收光栅图，理由见 §7）→ 计算 sha256 → 落盘 → 返回 `{ id, publicId, filename, contentType, sizeBytes, width, height }`。
  - 权限：editor+；agent 按 §6.1 策略（项目开关可决定是否开放）。
  - 实现骨架：

  ```ts
  export const POST = route(async (req, { params }) => {
    const { projectId } = await params;
    const requester = await getRequester(req);
    // ...权限与项目存在性校验（复用 checkMembership）
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err(400, "缺少 file 字段");
    const buf = Buffer.from(await file.arrayBuffer());
    const type = detectImageType(buf);            // 魔数检测，见 §6.4
    if (!type) return err(400, "仅支持 PNG/JPEG/GIF/WebP");
    if (buf.length > maxAssetBytes()) return err(413, "图片过大");
    const sha = sha256Hex(buf);
    const publicId = randomPublicId();            // nanoid/uuid，不可猜测
    await ensureDir(assetDir(projectId, sha));
    await fs.writeFile(assetPath(projectId, sha, type.ext), buf);
    // INSERT ... RETURNING（withUserContext / withAgentContext 包裹，RLS 兜底）
    return ok(asset, 201);
  });
  ```

- `GET /api/projects/{projectId}/assets`：列表（viewer+ / agent），供前端“素材库”面板。
- `GET /api/assets/{publicId}`：读图。响应头 `Content-Type: <检测出的类型>`、`Cache-Control: public, max-age=86400, immutable`（publicId 不可变）、`X-Content-Type-Options: nosniff`。鉴权：会话成员 / agent key；若带 `?token=`（公开投递用，见下）则跳过会话鉴权。
- `DELETE /api/assets/{publicId}`：editor+；同时删文件（若 sha256 无其他行引用）。
- （投递用）`POST /api/assets/{publicId}/public-url`：editor+ 按需生成一个**可撤销**的公开 token（存 assets 表或独立表），返回 `https://<domain>/api/assets/{publicId}?token=<128bit随机>`。默认不开，避免把私有图变成匿名可读。

### 6.4 前端接入（设计阶段）

- `detail.tsx` 的 `VersionEditor` 工具条加「插入图片」：打开素材库弹窗 → 支持本地上传（`api.assets.upload`）→ 选中后向 textarea 光标处插入：

  ```html
  <img src="/api/assets/{publicId}" width="600" alt="" style="display:block;width:100%;max-width:600px;" />
  ```

- 预览无需改动：`srcDoc` iframe 同源，cookie 自动带上（§4）。
- `client-api.ts` 增加 `api.assets.list/upload/remove`；共享类型 `src/lib/types.ts` 增加 `Asset`。
- 邮件 HTML 是表格布局 + 内联样式，插入的 `<img>` 也应带内联尺寸/`display:block`，避免 gap 问题；lint 已有 `image-no-size` 规则兜底提醒。

### 6.5 lint 规则更新（`src/lib/lint.ts`）

新增/调整：

- `data:` 图片 → `severity: error`：“Gmail/Outlook/iOS 不支持 base64 data URI，投递后图片会丢失，请改用素材库或托管 URL”。
- `cid:` 图片 → `severity: info`：“CID 需在发送/导出管线组装 MIME 才能显示（预览中不可见）”。
- `http://` 外链已 warn；补充提示 Gmail 会经图片代理缓存。
- 素材 URL `/api/assets/{id}` → 若缺 `width` 沿用现有 `image-no-size`。

### 6.6 导出 / 发送管线（把图片真正“嵌入”邮件）

这是“嵌入”的落点。给定一个版本 HTML，两种输出模式：

**A. 嵌入模式（CID，自包含）——推荐给“导入 ESP / SMTP 发送”的场景**

1. 用 `cheerio` 遍历 `<img src="/api/assets/{publicId}">`；
2. 把 `src` 改写为 `cid:{publicId}`（cid 值只含字母数字，不冲突）；
3. 组装 MIME（顺序对 Apple Mail 至关重要）：

```text
multipart/related; boundary="rel"
├── multipart/alternative; boundary="alt"
│   ├── text/plain（纯文本版本，可选）
│   └── text/html（改写好 cid 的 HTML）
├── image/png  Content-ID: <{publicId}>  Content-Disposition: inline; filename="..."
└── image/jpeg Content-ID: <{publicId2}> ...
```

若后续接入 SMTP，直接用 `nodemailer` 的 `attachments: [{ filename, content: Buffer, cid: publicId }]` 即自动生成上述结构；现阶段（无 SMTP）则提供一个 `POST /api/templates/:templateId/versions/:versionId/export?mode=embedded` 返回 `.eml` 或 ZIP，供手动导入/归档。也可以交付 `mode=html`（只改写 URL 为公开 token URL）。

**B. 托管模式（公开 URL）**

把 `/api/assets/{publicId}` 改写为带公开 token 的绝对 URL，交给 ESP 用；需要公网可达（线上域已具备）。此模式邮件更小、可缓存，但受客户端“默认不加载外图”影响。

### 6.7 安全清单

- **拒绝 SVG（MVP）**：SVG 可携带脚本/外链，虽然 `<img>` 上下文一般不执行脚本，但错误 Content-Type 或嗅探场景有 XSS 面；先只收光栅图，后续要 SVG 时强制 `Content-Disposition: attachment` / 白名单清洗。
- **魔数检测**而非扩展名/`file.type`（都可信不过）；`nosniff` + 精确 Content-Type。
- **路径穿越**：落盘路径只由服务端生成的 sha256/publicId 组成。
- **体积/配额**：单文件上限 + 项目总量配额（可选），防磁盘耗尽。
- **公开 token**：32 字节随机、可撤销、可选到期时间；不开默认公开。
- **鉴权一致性**：素材读与截图读同一套 RLS 兜底（服务端以 `edm_app` + 上下文变量查询，不直接信 URL）。
- **去重副作用**：按 sha256 删除文件前先查引用计数，避免误删共用文件。

## 7. 必须注意的坑

1. **预览 iframe 可用 cookie，Playwright 截图不行**。截图用 `page.setContent(html)`，无会话 cookie，`/api/assets/...` 会 401。两个解法：
   - 截图前把系统素材 URL 内联为 data URI（截图/预览专用，不进投递）；
   - 或给 Playwright `context.addCookies()` 注入会话（复杂、易过期）。
   推荐前者：`queue.ts` 的 `runScreenshot` 里对 `html` 做一次「素材 URL → data URI」的预览内联。
2. **`srcDoc` 的相对路径**。`<img src="/api/assets/...">` 在 iframe 里解析为同源绝对路径没问题；但若模板写相对路径或 `file://` 会失败——lint 可提示使用绝对路径。
3. **Gmail 图片代理**。托管模式会经 Google 代理缓存，个性化图片（每收件人不同）会被缓存成同一张；用 CID 则无此问题。
4. **base64 体积**。CID/base64 都让邮件 +33%；小图（几十 KB 内）无所谓，大图优先托管模式。
5. **Next.js 上传体大小**。上传走 Route Handler 的 `formData()`。Next.js 15.5+ 的
   `experimental.proxyClientMaxBodySize` **默认是 10 MB**（官方文档），超出时只缓冲
   到上限并告警；只有要放宽单文件上限（如 §6.3 的 5 MiB 以上）时才需在
   `next.config.ts` 显式调大（例如 `experimental: { proxyClientMaxBodySize: '20mb' }`）。
   应用层始终再按 §6.3 做业务上限兜底。
6. **迁移与运行约束**：按项目既有约定——改后端用 `npx tsc --noEmit` 自查，不跑 `next dev/build`（生产 systemd 正在运行，会互相覆盖 `.next`）。

## 8. 落地里程碑

- **M-A（素材库打通预览）**：`0013_assets.sql` + schema.ts + 上传/读取/列表/删除 API + 前端上传弹窗与“插入图片” + lint 新规则 + 截图内联 data URI。完成后即可“把图片放进模板并预览”。
- **M-B（真正嵌入投递）**：导出管线（CID 嵌入模式返回 `.eml`/ZIP，托管模式返回公开 URL 版 HTML）+ 可选公开 token 接口。
- **M-C（生态）**：接 ESP/SMTP 时用 nodemailer `cid` 附件直出；远程图片“下载并托管”后台任务；S3 兼容对象存储替代本地盘。

## 9. 参考来源

- Mailchimp Templates Guide — Images（“在 HTML 邮件里处理图片的正确方式是托管到 web 服务器并用绝对路径”）：`templates.mailchimp.com/design/images`
- MailPace — How to embed images in HTML emails（三种方式对比，结论首选 CDN URL）：`mailpace.com/blog/guides/how-to-embed-images-in-emails`
- CodeTwo — How to avoid problems with base64 images（Gmail 不支持 base64）：`codetwo.com/kb/base64-images`
- Microsoft Q&A（OWA 把 base64 data URI 替换为 1×1 透明 GIF，建议 CID/托管）：`learn.microsoft.com/answers/questions/5897712`
- n8n 社区（Outlook 桌面剥离 data URI）：`community.n8n.io/t/how-to-embed-images-in-html-emails-using-the-microsoft-outlook-node/297693`
- Pyramid mailer issue #74（Gmail/Thunderbird 要求 `multipart/related` 才显示 CID 内联图）：`github.com/Pylons/pyramid_mailer/issues/74`
- PHP 中文网 — 构建含内嵌图片的 multipart 邮件以兼容 Apple Mail（嵌套顺序；iOS 只支持 CID 不支持 base64）：`global.php.cn/zh/faq/1797015788.html`
- Nodemailer 文档 — Attachments as embedded images（`cid` 用法）
- Next.js 15.5 文件上传与 `proxyClientMaxBodySize` 配置：Cadence blog / GitHub 相关 issue

（以上结论均基于 2025-2026 公开资料；具体客户端行为仍建议用 Litmus / Email on Acid 等渲染测试服务对目标客户端做最终回归。）
