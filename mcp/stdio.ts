#!/usr/bin/env node
/**
 * EDM MCP · stdio 启动入口。
 *
 * 用法：
 *   EDM_API_KEY=edm_xxx EDM_API_BASE_URL=https://edm.neilx.online \
 *     npx tsx mcp/stdio.ts
 *
 * 环境变量：
 *   EDM_API_KEY       必填，项目 API key（edm_...）
 *   EDM_API_BASE_URL  可选，默认 http://127.0.0.1:3000
 *   EDM_PROJECT_ID    可选；省略时通过 /api/agent/me 自动发现
 *
 * 注意：stdio 通道只用于 MCP 协议，所有日志必须写 stderr。
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEdmMcpServer } from "../src/mcp/server";

function optionalProjectId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`EDM_PROJECT_ID 必须是正整数，当前为：${value}`);
  }
  return id;
}

async function main() {
  const apiKey = process.env.EDM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "缺少 EDM_API_KEY。请在项目设置 → API key 中创建，并以 edm_ 开头。",
    );
  }
  const baseUrl = (process.env.EDM_API_BASE_URL || "http://127.0.0.1:3000").trim();

  const server = createEdmMcpServer({
    baseUrl,
    apiKey,
    defaultProjectId: optionalProjectId(process.env.EDM_PROJECT_ID),
    allowLocalFiles: true,
    transport: "stdio",
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[edm-mcp] stdio 已启动（${baseUrl}）`);
}

async function shutdown() {
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error("[edm-mcp] 启动失败:", error instanceof Error ? error.message : error);
  process.exit(1);
});
