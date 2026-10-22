import type { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { validateApiKey } from "@/lib/api-keys";
import { createEdmMcpServer } from "@/mcp/server";

/**
 * 托管 MCP（MCP Streamable HTTP，无状态模式）。
 *
 * 客户端用项目 API key 认证：
 *   POST /api/mcp
 *   Authorization: Bearer edm_...
 *   Accept: application/json, text/event-stream
 *
 * 工具内部复用同一套 agent HTTP API，所以权限/审计/实时预览语义不变。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024 * 1024;

function rpcError(status: number, message: string, headers?: HeadersInit) {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32001, message },
      id: null,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
}

function methodNotAllowed(method: string) {
  return rpcError(405, `Method not allowed: ${method}`, { Allow: "POST" });
}

export async function POST(req: NextRequest): Promise<Response> {
  const authorization = req.headers.get("authorization");
  const key = await validateApiKey(authorization);
  if (!key || !authorization) {
    return rpcError(401, "认证失败：请提供有效的 Authorization: Bearer edm_<key>", {
      "WWW-Authenticate": 'Bearer realm="edm-mcp"',
    });
  }

  // 优先使用显式配置，其次复用部署时的公开 AUTH_URL；避免信任可伪造的 Host 头，
  // 否则工具调用可能把 Bearer key 发往攻击者指定的地址。
  const baseUrl = (
    process.env.EDM_MCP_API_BASE_URL ||
    process.env.AUTH_URL ||
    req.nextUrl.origin
  ).replace(/\/+$/, "");
  const server = createEdmMcpServer({
    baseUrl,
    apiKey: authorization,
    defaultProjectId: key.projectId,
    allowLocalFiles: false,
    transport: "http",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (error) {
    console.error("[mcp] 请求处理失败:", error);
    return rpcError(500, "MCP 服务器内部错误");
  }
}

export function GET(): Response {
  return methodNotAllowed("GET");
}

export function DELETE(): Response {
  return methodNotAllowed("DELETE");
}
