# EDM MCP 接入

把现有 **agent API** 包装成 MCP（Model Context Protocol）工具，让 Codex、Claude
Desktop、Cursor 等客户端以原生工具调用方式发现主题/模板、推送版本、查看截图和
管理图片。

MCP 工具不是另一套业务实现：每次调用仍走原 HTTP API，因此 API key 作用域、
`agent_can_approve` 开关、RLS、审计日志和 WebSocket 实时预览完全一致。

网页入口：

- **项目设置 → MCP**：查看 Server URL、创建 MCP key、复制托管/stdio 配置、查看工具清单
- **API 工具页 → MCP 接入**：按项目选择并生成同样的配置

## 两种接入方式

| 方式 | 地址 / 命令 | 适用场景 |
| --- | --- | --- |
| 托管 MCP（Streamable HTTP，无状态） | `POST https://edm.neilx.online/api/mcp` | 远程 agent、无需本机 Node |
| stdio MCP | `npm run mcp` | 本机客户端、需要读取本地图片文件 |

两种方式都使用项目 API key：`Authorization: Bearer edm_<key>`。
key 在「项目设置 → API key」创建，明文只展示一次。

## 托管 MCP

客户端配置（以通用 JSON 为例）：

```json
{
  "mcpServers": {
    "edm": {
      "url": "https://edm.neilx.online/api/mcp",
      "headers": {
        "Authorization": "Bearer edm_<your-key>"
      }
    }
  }
}
```

要求：

- 请求头 `Accept: application/json, text/event-stream`（MCP 客户端会自动发送）。
- 请求体上限 16 MB。图片请用 `data_base64` 传入，单张 ≤ 10 MB。
- 托管模式**禁止** `file_path`，避免远程调用读取服务器文件。
- 项目 ID 由 API key 自动确定，工具中的 `project_id` 可省略；显式传入其他项目会被
  API 拒绝。

手动探测：

```bash
curl -i -X POST https://edm.neilx.online/api/mcp \
  -H "Authorization: Bearer edm_<key>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## stdio MCP

```bash
cd /home/ubuntu/EDM

EDM_API_KEY=edm_<key> \
EDM_API_BASE_URL=https://edm.neilx.online \
npm run mcp
```

客户端配置示例（本机仓库路径按实际部署调整）：

```json
{
  "mcpServers": {
    "edm": {
      "command": "/home/ubuntu/EDM/node_modules/.bin/tsx",
      "args": ["/home/ubuntu/EDM/mcp/stdio.ts"],
      "env": {
        "EDM_API_KEY": "edm_<your-key>",
        "EDM_API_BASE_URL": "https://edm.neilx.online"
      }
    }
  }
}
```

环境变量：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `EDM_API_KEY` | 是 | 项目 API key（`edm_...`） |
| `EDM_API_BASE_URL` | 否 | 默认 `http://127.0.0.1:3000` |
| `EDM_PROJECT_ID` | 否 | 省略时调用 `/api/agent/me` 自动发现 |

stdio 模式额外支持 `edm_upload_image` 的 `file_path` 参数，可直接上传本机图片。

## 工具清单

| 工具 | 对应 HTTP API | 说明 |
| --- | --- | --- |
| `edm_get_context` | `GET /api/agent/me` | 当前 key 的项目、项目名、key 信息 |
| `edm_list_topics` | `GET /api/projects/:projectId/topics` | 主题列表 |
| `edm_list_templates` | `GET /api/projects/:projectId/templates` | 模板列表，支持主题/标签/状态/关键词过滤 |
| `edm_list_versions` | `GET /api/templates/:templateId/versions` | 版本历史（默认 20 条） |
| `edm_get_version` | `GET /api/versions/:versionId` | 单个版本完整内容 |
| `edm_push_version` | `POST /api/templates/:templateId/versions` | 推送新版本，draft / saved |
| `edm_approve_version` | `POST /api/templates/:templateId/versions/:versionId/approve` | 采纳 draft |
| `edm_get_version_screenshot` | `GET /api/versions/:versionId/screenshots/:kind` | 返回 desktop / mobile 截图图片 |
| `edm_list_images` | `GET /api/projects/:projectId/images` | 项目图片库 |
| `edm_upload_image` | `POST /api/projects/:projectId/images` | base64 / 本地文件上传，自动去重 |
| `edm_get_image` | `GET /api/images/:imageId` | 返回图片原图 |
| `edm_delete_image` | `DELETE /api/images/:imageId` | 仅能删除本 key 上传的图片 |

## 典型流程

```text
1. edm_get_context                         → 拿到 projectId
2. edm_list_topics / edm_list_templates    → 拿到 templateId
3. edm_push_version (status=draft)         → 浏览器实时预览
4. edm_get_version_screenshot              → 检查桌面/移动端渲染
5. 迭代 3-4
6. edm_push_version (status=saved)         → 或 edm_approve_version
```

创建主题/模板、回滚版本、重命名图片仍仅限登录用户，不在 agent/MCP 能力范围内。

## 实现位置

- `src/mcp/client.ts`：EDM HTTP API 客户端
- `src/mcp/server.ts`：MCP 工具注册（stdio 与托管共用）
- `src/app/api/mcp/route.ts`：托管 Streamable HTTP 入口
- `mcp/stdio.ts`：stdio 启动入口
- `src/app/api/agent/me/route.ts`：API key 自省
- `scripts/mcp-test.ts`：mock API 全工具测试（`npm run mcp:test`）
- `scripts/mcp-ui-smoke.mts`：网页入口冒烟（`npm run mcp:ui-smoke`）
