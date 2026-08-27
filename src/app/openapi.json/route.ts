import { ok } from "@/lib/api";
import { route } from "@/lib/route";

const OPENAPI_DOC = {
  openapi: "3.0.3",
  info: {
    title: "EDM 邮件模板预览与管理系统 API",
    version: "0.1.0",
    description:
      "供 AI agent 使用的接口：携带 `Authorization: Bearer edm_<key>`，可在所属项目内只读发现主题与模板、提交版本、读取历史与任务状态，并上传/管理项目图片。创建主题/模板仅限登录用户（不在本清单中）。",
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/projects/{projectId}/topics": {
      get: {
        summary: "项目主题列表（agent 可读）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { 200: { description: "主题列表" } },
      },
    },
    "/api/projects/{projectId}/templates": {
      get: {
        summary: "项目模板列表（agent 可读，可按主题/标签/状态/关键词过滤）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
          { name: "topicId", in: "query", required: false, schema: { type: "integer" } },
          { name: "tag", in: "query", required: false, schema: { type: "string" } },
          { name: "q", in: "query", required: false, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "archived"] } },
        ],
        responses: { 200: { description: "模板列表（含主题信息与最新版本状态）" } },
      },
    },
    "/api/templates/{templateId}/versions": {
      get: {
        summary: "版本历史（含 lint/截图任务状态）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "templateId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { 200: { description: "版本列表" } },
      },
      post: {
        summary: "提交新版本（实时推送预览）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "templateId", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["html"],
                properties: {
                  html: { type: "string", description: "邮件 HTML" },
                  source: { type: "string", description: "原始 MJML 或 HTML" },
                  note: { type: "string", description: "提交说明" },
                  status: {
                    type: "string",
                    enum: ["draft", "saved"],
                    description:
                      "draft=实时迭代；saved=直接采纳（需项目开启 agent_can_approve）",
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: "已创建版本" } },
      },
    },
    "/api/templates/{templateId}/versions/{versionId}/approve": {
      post: {
        summary: "采纳版本为 saved",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "templateId", in: "path", required: true, schema: { type: "integer" } },
          { name: "versionId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { 200: { description: "已采纳" } },
      },
    },
    "/api/versions/{versionId}": {
      get: {
        summary: "读取单个版本详情",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "versionId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { 200: { description: "版本详情" } },
      },
    },
    "/api/versions/{versionId}/screenshots/{kind}": {
      get: {
        summary: "读取版本截图（desktop / mobile）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "versionId", in: "path", required: true, schema: { type: "integer" } },
          { name: "kind", in: "path", required: true, schema: { type: "string", enum: ["desktop", "mobile"] } },
        ],
        responses: { 200: { description: "PNG" } },
      },
    },
    "/api/projects/{projectId}/images": {
      get: {
        summary: "项目图片列表（含可直接引用的图片 URL）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { 200: { description: "图片列表" } },
      },
      post: {
        summary: "上传图片到项目图片库",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: "PNG / JPEG / WebP / GIF，最大 10 MB",
                  },
                  name: {
                    type: "string",
                    description: "展示名称（可选，默认取文件名）",
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "已上传，返回图片对象（含 url，可直接嵌入邮件 HTML）",
          },
        },
      },
    },
    "/api/images/{imageId}": {
      get: {
        summary: "读取图片原图（可用 Bearer key 或登录 cookie）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "imageId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { 200: { description: "图片二进制" } },
      },
      delete: {
        summary: "删除图片（仅限上传该图片的 agent 本人）",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "imageId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { 200: { description: "已删除" } },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description: "Bearer edm_<api key>（在项目设置中创建）",
      },
    },
  },
};

export const GET = route(async () => {
  return ok(OPENAPI_DOC);
});
