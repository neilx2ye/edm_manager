/**
 * EDM HTTP API 客户端（MCP 专用）。
 *
 * MCP 工具不直接访问数据库，而是复用现有 agent API：
 * 鉴权、项目隔离、agent_can_approve、审计与实时通知语义都保持一致。
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface EdmApiClientOptions {
  /** EDM 站点根地址，例如 https://edm.neilx.online 或 http://127.0.0.1:3000 */
  baseUrl: string;
  /** 项目 API key（edm_...）；也接受已带 Bearer 前缀的形式 */
  apiKey: string;
  /** API key 所属项目。托管 MCP 可直接注入；stdio 未配置时会调用 /api/agent/me 自动发现 */
  defaultProjectId?: number;
  fetchImpl?: typeof fetch;
}

export interface AgentIdentity {
  keyId: number;
  keyName: string;
  projectId: number;
  projectName: string;
}

export interface BinaryResponse {
  bytes: Buffer;
  contentType: string;
}

export interface UploadImageInput {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  name?: string;
}

export class EdmApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = "EdmApiError";
    this.status = status;
    this.body = body;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export class EdmApiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private defaultProjectId?: number;
  private identityPromise?: Promise<AgentIdentity>;

  constructor(options: EdmApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey.replace(/^Bearer\s+/i, "").trim();
    this.defaultProjectId = options.defaultProjectId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.baseUrl) throw new Error("EDM_API_BASE_URL 不能为空");
    if (!this.apiKey) throw new Error("EDM_API_KEY 不能为空");
  }

  /** 当前 key 的项目身份（额外调用一次 /api/agent/me，进程内缓存）。 */
  identity(force = false): Promise<AgentIdentity> {
    if (!this.identityPromise || force) {
      this.identityPromise = this.requestJson<AgentIdentity>(
        "/api/agent/me",
      ).catch((error) => {
        // 失败不缓存，避免临时网络/服务不可用后永久失效。
        this.identityPromise = undefined;
        throw error;
      });
    }
    return this.identityPromise;
  }

  /** 解析项目 ID：显式参数 > 配置默认值 > /api/agent/me 自动发现。 */
  async resolveProjectId(projectId?: number): Promise<number> {
    if (projectId) return projectId;
    if (this.defaultProjectId) return this.defaultProjectId;
    const identity = await this.identity();
    this.defaultProjectId = identity.projectId;
    return identity.projectId;
  }

  listTopics(projectId?: number): Promise<unknown> {
    return this.projectRequest(projectId, (id) =>
      this.requestJson(`/api/projects/${id}/topics`),
    );
  }

  listTemplates(
    filters: {
      projectId?: number;
      topicId?: number;
      tag?: string;
      q?: string;
      status?: "active" | "archived";
    } = {},
  ): Promise<unknown> {
    return this.projectRequest(filters.projectId, (id) =>
      this.requestJson(`/api/projects/${id}/templates`, {
        query: {
          topicId: filters.topicId,
          tag: filters.tag,
          q: filters.q,
          status: filters.status,
        },
      }),
    );
  }

  listVersions(
    templateId: number,
    options: { limit?: number; offset?: number } = {},
  ): Promise<unknown> {
    return this.requestJson(`/api/templates/${templateId}/versions`, {
      query: { limit: options.limit, offset: options.offset },
    });
  }

  getVersion(versionId: number): Promise<unknown> {
    return this.requestJson(`/api/versions/${versionId}`);
  }

  pushVersion(input: {
    templateId: number;
    html: string;
    source?: string;
    note?: string;
    status?: "draft" | "saved";
  }): Promise<unknown> {
    return this.requestJson(`/api/templates/${input.templateId}/versions`, {
      method: "POST",
      body: {
        html: input.html,
        source: input.source,
        note: input.note,
        status: input.status ?? "draft",
      },
    });
  }

  approveVersion(templateId: number, versionId: number): Promise<unknown> {
    return this.requestJson(
      `/api/templates/${templateId}/versions/${versionId}/approve`,
      { method: "POST" },
    );
  }

  getScreenshot(
    versionId: number,
    kind: "desktop" | "mobile",
  ): Promise<BinaryResponse> {
    return this.requestBinary(
      `/api/versions/${versionId}/screenshots/${kind}`,
    );
  }

  listImages(projectId?: number): Promise<unknown> {
    return this.projectRequest(projectId, (id) =>
      this.requestJson(`/api/projects/${id}/images`),
    );
  }

  async uploadImage(
    projectId: number | undefined,
    input: UploadImageInput,
  ): Promise<Record<string, unknown>> {
    const id = await this.resolveProjectId(projectId);
    if (input.bytes.length === 0) throw new Error("图片内容为空");
    if (input.bytes.length > MAX_IMAGE_BYTES) {
      throw new Error("图片不能超过 10 MB");
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
      input.filename,
    );
    if (input.name) form.append("name", input.name);

    const data = await this.requestJson<Record<string, unknown>>(
      `/api/projects/${id}/images`,
      { method: "POST", form },
    );
    return {
      ...data,
      absolute_url:
        typeof data.url === "string" ? `${this.baseUrl}${data.url}` : undefined,
    };
  }

  getImage(imageId: number): Promise<BinaryResponse> {
    return this.requestBinary(`/api/images/${imageId}`);
  }

  deleteImage(imageId: number): Promise<unknown> {
    return this.requestJson(`/api/images/${imageId}`, { method: "DELETE" });
  }

  private async projectRequest<T>(
    projectId: number | undefined,
    fn: (id: number) => Promise<T>,
  ): Promise<T> {
    return fn(await this.resolveProjectId(projectId));
  }

  private async requestJson<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      form?: FormData;
      query?: Record<string, QueryValue>;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await this.fetchImpl(this.url(path, options.query), {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
    });

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const message =
        (data as { error?: string } | null)?.error ??
        `EDM API 请求失败（${res.status}）`;
      throw new EdmApiError(res.status, message, data);
    }
    return data as T;
  }

  private async requestBinary(path: string): Promise<BinaryResponse> {
    const res = await this.fetchImpl(this.url(path), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "*/*",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        // 保留原文
      }
      const message =
        (data as { error?: string } | null)?.error ??
        `EDM API 请求失败（${res.status}）`;
      throw new EdmApiError(res.status, message, data);
    }
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      contentType:
        res.headers.get("content-type")?.split(";")[0]?.trim() ||
        "application/octet-stream",
    };
  }

  private url(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path, `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }
}

/** 从文件名推断图片 MIME（仅用于 multipart 声明，服务端仍校验魔数）。 */
export function inferImageMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}
