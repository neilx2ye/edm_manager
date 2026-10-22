/**
 * MCP 工具层测试：用本地 mock EDM API 验证全部工具、鉴权头、项目自动发现与错误映射。
 *
 *   npm run mcp:test
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import path from "node:path";
import { createEdmMcpServer } from "../src/mcp/server";

interface Captured {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
  body: Buffer;
  contentType: string | undefined;
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const captured: Captured[] = [];
let fail404 = false;

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://mock.local");
  const body = await readBody(req);
  captured.push({
    method: req.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    authorization: req.headers.authorization,
    body,
    contentType: req.headers["content-type"],
  });

  if (fail404 && url.pathname === "/api/versions/404") {
    return json(res, 404, { error: "版本不存在" });
  }

  const routes: Record<string, () => void> = {
    "/api/agent/me": () =>
      json(res, 200, {
        keyId: 9,
        keyName: "codex",
        projectId: 7,
        projectName: "营销邮件",
      }),
    "/api/projects/7/topics": () =>
      json(res, 200, [{ id: 3, name: "Welcome", template_count: 2 }]),
    "/api/projects/7/templates": () =>
      json(res, 200, [{ id: 11, name: "Welcome 1", latest_version_id: 22 }]),
    "/api/templates/11/versions": () => {
      if (req.method === "POST") {
        return json(res, 201, {
          id: 23,
          template_id: 11,
          status: "saved",
          note: "v2",
        });
      }
      return json(res, 200, [{ id: 22, status: "draft", html: "<html></html>" }]);
    },
    "/api/versions/22": () =>
      json(res, 200, { id: 22, template_id: 11, status: "draft" }),
    "/api/templates/11/versions/22/approve": () =>
      json(res, 200, { id: 22, status: "saved", template_id: 11 }),
    "/api/versions/22/screenshots/desktop": () => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
    },
    "/api/projects/7/images": () => {
      if (req.method === "POST") {
        return json(res, 201, {
          id: 5,
          name: "首屏主图",
          content_type: "image/png",
          size_bytes: PNG.length,
          url: "/api/images/5",
          deduplicated: false,
        });
      }
      return json(res, 200, [{ id: 5, url: "/api/images/5" }]);
    },
    "/api/images/5": () => {
      if (req.method === "DELETE") return json(res, 200, { ok: true });
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
    },
  };

  const handler = routes[url.pathname];
  if (!handler) return json(res, 404, { error: `未 mock 的路径 ${url.pathname}` });
  handler();
});

async function connectClient(defaultProjectId: number | undefined) {
  const server = createEdmMcpServer({
    baseUrl: `http://127.0.0.1:${(mock.address() as AddressInfo).port}`,
    apiKey: "edm_test_key",
    defaultProjectId,
    allowLocalFiles: false,
    transport: "http",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { server, client };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })
    .content;
  assert.ok(content && content.length > 0, "工具结果应包含 content");
  const first = content[0];
  assert.equal(first.type, "text");
  return first.text ?? "";
}

function jsonOf(result: unknown): any {
  return JSON.parse(textOf(result));
}

async function main() {
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));

  const { server, client } = await connectClient(7);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "edm_approve_version",
      "edm_delete_image",
      "edm_get_context",
      "edm_get_image",
      "edm_get_version",
      "edm_get_version_screenshot",
      "edm_list_images",
      "edm_list_templates",
      "edm_list_topics",
      "edm_list_versions",
      "edm_push_version",
      "edm_upload_image",
    ]);
    console.log("PASS tools/list 暴露 12 个工具");

    const context = jsonOf(await client.callTool({ name: "edm_get_context", arguments: {} }));
    assert.equal(context.projectId, 7);
    assert.equal(context.projectName, "营销邮件");
    assert.equal(context.allowLocalFiles, false);
    console.log("PASS edm_get_context");

    const topics = jsonOf(
      await client.callTool({ name: "edm_list_topics", arguments: {} }),
    );
    assert.equal(topics[0].id, 3);
    const topicsReq = captured.find((r) => r.path === "/api/projects/7/topics");
    assert.equal(topicsReq?.authorization, "Bearer edm_test_key");
    console.log("PASS edm_list_topics 默认项目 + Bearer 鉴权");

    await client.callTool({
      name: "edm_list_templates",
      arguments: {
        topic_id: 3,
        tag: "welcome",
        q: "欢迎",
        status: "active",
      },
    });
    const templatesReq = captured.find(
      (r) => r.path === "/api/projects/7/templates" && r.method === "GET",
    );
    assert.equal(templatesReq?.query.get("topicId"), "3");
    assert.equal(templatesReq?.query.get("tag"), "welcome");
    assert.equal(templatesReq?.query.get("q"), "欢迎");
    assert.equal(templatesReq?.query.get("status"), "active");
    console.log("PASS edm_list_templates 过滤参数");

    await client.callTool({
      name: "edm_list_versions",
      arguments: { template_id: 11 },
    });
    const versionsReq = captured.find(
      (r) => r.path === "/api/templates/11/versions",
    );
    assert.equal(versionsReq?.query.get("limit"), "20");
    assert.equal(versionsReq?.query.get("offset"), "0");
    console.log("PASS edm_list_versions 分页默认值");

    await client.callTool({
      name: "edm_get_version",
      arguments: { version_id: 22 },
    });
    assert.ok(captured.some((r) => r.path === "/api/versions/22"));
    console.log("PASS edm_get_version");

    const pushed = jsonOf(
      await client.callTool({
        name: "edm_push_version",
        arguments: {
          template_id: 11,
          html: "<html><body>hi</body></html>",
          note: "v2",
          status: "saved",
        },
      }),
    );
    assert.equal(pushed.status, "saved");
    const pushReq = captured.find(
      (r) =>
        r.path === "/api/templates/11/versions" &&
        r.method === "POST",
    );
    const pushBody = JSON.parse(pushReq!.body.toString("utf8"));
    assert.equal(pushBody.html, "<html><body>hi</body></html>");
    assert.equal(pushBody.status, "saved");
    assert.equal(pushReq?.authorization, "Bearer edm_test_key");
    console.log("PASS edm_push_version 请求体与鉴权");

    await client.callTool({
      name: "edm_approve_version",
      arguments: { template_id: 11, version_id: 22 },
    });
    assert.ok(
      captured.some(
        (r) => r.path === "/api/templates/11/versions/22/approve",
      ),
    );
    console.log("PASS edm_approve_version");

    const shot = (await client.callTool({
      name: "edm_get_version_screenshot",
      arguments: { version_id: 22, kind: "desktop" },
    })) as any;
    assert.equal(shot.content[0].type, "image");
    assert.equal(shot.content[0].mimeType, "image/png");
    assert.equal(Buffer.from(shot.content[0].data, "base64").length, PNG.length);
    console.log("PASS edm_get_version_screenshot 返回图片内容");

    const uploaded = jsonOf(
      await client.callTool({
        name: "edm_upload_image",
        arguments: {
          data_base64: PNG.toString("base64"),
          filename: "hero.png",
          name: "首屏主图",
        },
      }),
    );
    assert.equal(uploaded.id, 5);
    assert.match(uploaded.absolute_url, /\/api\/images\/5$/);
    const uploadReq = captured.find(
      (r) => r.path === "/api/projects/7/images" && r.method === "POST",
    );
    assert.match(uploadReq?.contentType ?? "", /^multipart\/form-data; boundary=/);
    const uploadRaw = uploadReq!.body.toString("utf8");
    assert.match(uploadRaw, /name="file"; filename="hero.png"/);
    assert.match(uploadRaw, /name="name"/);
    assert.match(uploadRaw, /首屏主图/);
    console.log("PASS edm_upload_image base64 → multipart");

    const image = (await client.callTool({
      name: "edm_get_image",
      arguments: { image_id: 5 },
    })) as any;
    assert.equal(image.content[0].type, "image");
    assert.equal(image.content[0].mimeType, "image/png");

    const deleted = jsonOf(
      await client.callTool({
        name: "edm_delete_image",
        arguments: { image_id: 5 },
      }),
    );
    assert.equal(deleted.ok, true);
    assert.ok(
      captured.some((r) => r.path === "/api/images/5" && r.method === "DELETE"),
    );
    console.log("PASS edm_get_image / edm_delete_image");

    const rejected = (await client.callTool({
      name: "edm_upload_image",
      arguments: { file_path: "/etc/passwd", filename: "x.png" },
    })) as any;
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /不允许读取服务器文件/);
    console.log("PASS 托管模式拒绝 file_path");

    fail404 = true;
    const missing = (await client.callTool({
      name: "edm_get_version",
      arguments: { version_id: 404 },
    })) as any;
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /HTTP 404/);
    fail404 = false;
    console.log("PASS API 错误映射为 isError");
  } finally {
    await client.close();
    await server.close();
  }

  // 未配置 defaultProjectId 时，项目级工具应通过 /api/agent/me 自动发现。
  captured.length = 0;
  const auto = await connectClient(undefined);
  try {
    await auto.client.callTool({ name: "edm_list_images", arguments: {} });
    const order = captured.map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(order, [
      "GET /api/agent/me",
      "GET /api/projects/7/images",
    ]);
    console.log("PASS 未配置项目时自动调用 /api/agent/me");
  } finally {
    await auto.client.close();
    await auto.server.close();
  }

  // stdio 入口冒烟：真实 spawn `mcp/stdio.ts`，验证环境变量与协议握手。
  const stdio = new StdioClientTransport({
    command: path.resolve("node_modules/.bin/tsx"),
    args: [path.resolve("mcp/stdio.ts")],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      EDM_API_KEY: "edm_test_key",
      EDM_API_BASE_URL: `http://127.0.0.1:${(mock.address() as AddressInfo).port}`,
      EDM_PROJECT_ID: "7",
    },
    stderr: "pipe",
  });
  const stdioClient = new Client({ name: "mcp-stdio-test", version: "1.0.0" });
  try {
    await stdioClient.connect(stdio);
    const context = jsonOf(
      await stdioClient.callTool({ name: "edm_get_context", arguments: {} }),
    );
    assert.equal(context.transport, "stdio");
    assert.equal(context.allowLocalFiles, true);
    assert.equal(context.projectId, 7);
    console.log("PASS stdio 入口握手与 edm_get_context");
  } finally {
    await stdioClient.close();
  }

  await new Promise<void>((resolve, reject) =>
    mock.close((err) => (err ? reject(err) : resolve())),
  );
  console.log("\n全部 MCP 测试通过 ✅");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
