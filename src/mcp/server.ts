import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EdmApiClient,
  EdmApiError,
  inferImageMime,
  MAX_IMAGE_BYTES,
} from "./client";

export const EDM_MCP_VERSION = "0.1.0";

export interface EdmMcpServerOptions {
  baseUrl: string;
  apiKey: string;
  /** API key 所属项目；未提供时调用 /api/agent/me 自动发现 */
  defaultProjectId?: number;
  /** stdio 模式可允许读取本机文件；托管 HTTP 模式必须为 false */
  allowLocalFiles?: boolean;
  /** 仅用于 edm_get_context 展示 */
  transport?: "stdio" | "http";
  fetchImpl?: typeof fetch;
  version?: string;
}

const idSchema = z.coerce.number().int().positive();

function text(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  if (error instanceof EdmApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `EDM API 错误（HTTP ${error.status}）：${error.message}`,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `MCP 工具执行失败：${message}` }],
  };
}

function imageResult(bytes: Buffer, mimeType: string) {
  return {
    content: [
      {
        type: "image" as const,
        data: bytes.toString("base64"),
        mimeType,
      },
    ],
  };
}

/**
 * 注册 EDM agent API 的全部能力。
 *
 * 工具通过 HTTP 调用现有 API（而不是绕过 API 直连数据库），因此项目隔离、
 * agent_can_approve 开关、审计日志和 WebSocket 实时刷新都与普通 agent 完全一致。
 */
export function createEdmMcpServer(options: EdmMcpServerOptions): McpServer {
  const api = new EdmApiClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    defaultProjectId: options.defaultProjectId,
    fetchImpl: options.fetchImpl,
  });
  const allowLocalFiles = options.allowLocalFiles ?? false;

  const server = new McpServer(
    { name: "edm-mail-preview", version: options.version ?? EDM_MCP_VERSION },
    {
      instructions:
        "EDM 邮件模板预览系统。先用 edm_list_topics / edm_list_templates 找到 templateId，" +
        "再用 edm_push_version 推送 HTML（draft 实时预览，saved 直接采纳）。" +
        "创建主题/模板、回滚版本仍仅限登录用户；agent 能否直接采纳 saved 由项目开关决定。",
    },
  );

  type ToolConfig<Shape extends z.ZodRawShape> = {
    title?: string;
    description?: string;
    inputSchema?: Shape;
    annotations?: {
      title?: string;
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    };
  };

  const register = <Shape extends z.ZodRawShape = {}>(
    name: string,
    config: ToolConfig<Shape>,
    fn: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
  ) => {
    const callback = async (rawArgs: unknown) => {
      try {
        return await fn(rawArgs as z.infer<z.ZodObject<Shape>>);
      } catch (error) {
        return errorResult(error);
      }
    };
    // SDK 的重载在泛型包装下无法自动选出正确签名；工具级类型已由上面的
    // ToolConfig / fn 约束保证。
    server.registerTool(name, config as never, callback as never);
  };

  register(
    "edm_get_context",
    {
      title: "查看当前 EDM 身份",
      description:
        "返回当前 API key 所属项目、项目名、key 信息与 MCP 服务地址。" +
        "项目 ID 未知时先调用此工具；后续项目级工具也可省略 project_id。",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const identity = await api.identity();
      return text({
        baseUrl: api.baseUrl,
        projectId: identity.projectId,
        projectName: identity.projectName,
        keyId: identity.keyId,
        keyName: identity.keyName,
        transport: options.transport ?? "stdio",
        allowLocalFiles,
      });
    },
  );

  register(
    "edm_list_topics",
    {
      title: "列出项目主题",
      description:
        "列出项目下的主题（topic），返回主题 ID、名称、用途与模板数量。" +
        "省略 project_id 时使用 API key 所属项目。",
      inputSchema: {
        project_id: idSchema.optional().describe("项目 ID；省略则使用 key 所属项目"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id }) => text(await api.listTopics(project_id)),
  );

  register(
    "edm_list_templates",
    {
      title: "列出项目模板",
      description:
        "列出项目下的邮件模板，可按主题、标签、状态、关键词过滤。" +
        "返回项包含最新版本状态与 lint 报告；创建模板需登录用户，不在 MCP 能力内。",
      inputSchema: {
        project_id: idSchema.optional().describe("项目 ID；省略则使用 key 所属项目"),
        topic_id: idSchema.optional().describe("仅返回指定主题下的模板"),
        tag: z.string().optional().describe("按标签精确过滤"),
        q: z.string().optional().describe("按模板名称/用途模糊搜索"),
        status: z
          .enum(["active", "archived"])
          .optional()
          .describe("模板状态过滤"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id, topic_id, tag, q, status }) =>
      text(
        await api.listTemplates({
          projectId: project_id,
          topicId: topic_id,
          tag,
          q,
          status,
        }),
      ),
  );

  register(
    "edm_list_versions",
    {
      title: "列出版本历史",
      description:
        "按时间倒序列出模板版本（含 HTML/source、状态、lint 报告与截图任务）。" +
        "响应可能较大，默认只取 20 条；读取单个版本请用 edm_get_version。",
      inputSchema: {
        template_id: idSchema.describe("模板 ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .describe("返回条数（1-200，默认 20）"),
        offset: z.number().int().min(0).default(0).describe("分页偏移"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ template_id, limit, offset }) =>
      text(await api.listVersions(template_id, { limit, offset })),
  );

  register(
    "edm_get_version",
    {
      title: "读取版本详情",
      description: "读取单个版本的完整 HTML、source、状态、lint 报告与所属模板信息。",
      inputSchema: { version_id: idSchema.describe("版本 ID") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ version_id }) => text(await api.getVersion(version_id)),
  );

  register(
    "edm_push_version",
    {
      title: "推送新版本",
      description:
        "向模板提交新版本并实时触发预览。" +
        "status=draft 用于迭代；status=saved 直接采纳，需项目开启 agent_can_approve（默认开启）。" +
        "版本不可变，回滚只能由登录用户操作。",
      inputSchema: {
        template_id: idSchema.describe("模板 ID"),
        html: z.string().min(1).describe("完整邮件 HTML"),
        source: z.string().optional().describe("原始 MJML/源文件内容"),
        note: z.string().optional().describe("提交说明，便于版本时间线识别"),
        status: z
          .enum(["draft", "saved"])
          .default("draft")
          .describe("draft=实时迭代；saved=直接采纳"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ template_id, html, source, note, status }) =>
      text(
        await api.pushVersion({
          templateId: template_id,
          html,
          source,
          note,
          status,
        }),
      ),
  );

  register(
    "edm_approve_version",
    {
      title: "采纳草稿版本",
      description:
        "把 draft 版本标记为 saved。受项目 agent_can_approve 开关约束；" +
        "若开关关闭，请让登录用户在网页中采纳。",
      inputSchema: {
        template_id: idSchema.describe("模板 ID"),
        version_id: idSchema.describe("版本 ID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ template_id, version_id }) =>
      text(await api.approveVersion(template_id, version_id)),
  );

  register(
    "edm_get_version_screenshot",
    {
      title: "读取版本截图",
      description:
        "读取 Playwright 生成的最新截图并作为图片返回（desktop / mobile）。" +
        "截图任务可能仍在排队，尚未生成时 API 会返回 404。",
      inputSchema: {
        version_id: idSchema.describe("版本 ID"),
        kind: z.enum(["desktop", "mobile"]).describe("截图类型"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ version_id, kind }) => {
      const screenshot = await api.getScreenshot(version_id, kind);
      return imageResult(screenshot.bytes, screenshot.contentType);
    },
  );

  register(
    "edm_list_images",
    {
      title: "列出项目图片",
      description:
        "列出项目图片库，返回图片 ID、名称、MIME、大小和可直接引用的 URL。",
      inputSchema: {
        project_id: idSchema.optional().describe("项目 ID；省略则使用 key 所属项目"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id }) => text(await api.listImages(project_id)),
  );

  register(
    "edm_upload_image",
    {
      title: "上传项目图片",
      description:
        "上传 PNG / JPEG / WebP / GIF（≤10 MB）到项目图片库，返回绝对 URL 与 image_id，" +
        "可直接写入邮件 HTML。相同内容会自动去重。" +
        "托管 MCP 只能传 data_base64；stdio 模式还可传本机 file_path。",
      inputSchema: {
        project_id: idSchema.optional().describe("项目 ID；省略则使用 key 所属项目"),
        data_base64: z
          .string()
          .optional()
          .describe("图片 base64（可带 data:image/...;base64, 前缀）"),
        file_path: z
          .string()
          .optional()
          .describe("本机图片绝对路径（仅 stdio 模式可用）"),
        mime_type: z
          .string()
          .optional()
          .describe("MIME 类型；省略时按 filename 后缀推断"),
        filename: z.string().optional().describe("文件名（用于 multipart 与默认名称）"),
        name: z.string().optional().describe("图片展示名称"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, data_base64, file_path, mime_type, filename, name }) => {
      if (data_base64 && file_path) {
        throw new Error("data_base64 与 file_path 只能二选一");
      }
      if (!data_base64 && !file_path) {
        throw new Error("需要提供 data_base64 或 file_path");
      }

      let bytes: Buffer;
      let resolvedFilename: string;
      if (file_path) {
        if (!allowLocalFiles) {
          throw new Error(
            "托管 MCP 出于安全原因不允许读取服务器文件，请改用 data_base64",
          );
        }
        const info = await stat(file_path);
        if (!info.isFile()) throw new Error(`${file_path} 不是普通文件`);
        if (info.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 10 MB");
        bytes = await readFile(file_path);
        resolvedFilename = filename || basename(file_path);
      } else {
        const raw = data_base64!.replace(
          /^data:[^;,]+;base64,/i,
          "",
        );
        bytes = Buffer.from(raw, "base64");
        resolvedFilename = filename || "upload";
      }

      if (bytes.length === 0) throw new Error("图片内容为空或 base64 无效");
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error("图片不能超过 10 MB");

      const resolvedMime =
        mime_type || inferImageMime(resolvedFilename);
      if (resolvedMime === "application/octet-stream") {
        throw new Error("无法推断图片类型，请提供 mime_type 或带扩展名的 filename");
      }

      return text(
        await api.uploadImage(project_id, {
          bytes,
          filename: resolvedFilename,
          mimeType: resolvedMime,
          name,
        }),
      );
    },
  );

  register(
    "edm_get_image",
    {
      title: "读取图片原图",
      description: "按 image_id 读取项目图片原图，作为图片内容返回。",
      inputSchema: { image_id: idSchema.describe("图片 ID") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ image_id }) => {
      const image = await api.getImage(image_id);
      return imageResult(image.bytes, image.contentType);
    },
  );

  register(
    "edm_delete_image",
    {
      title: "删除项目图片",
      description:
        "删除图片。agent 只能删除自己上传的图片；项目管理员也可在网页中删除任意图片。",
      inputSchema: { image_id: idSchema.describe("图片 ID") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ image_id }) => text(await api.deleteImage(image_id)),
  );

  return server;
}
