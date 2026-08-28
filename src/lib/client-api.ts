/** 浏览器端 API 客户端：统一 JSON 解析与错误抛出。 */

import type {
  ApiKeyInfo,
  Project,
  ProjectMember,
  Role,
  SessionUser,
  TemplateDetail,
  TemplateSummary,
  Topic,
  UserAccount,
  UserMembership,
  Version,
  Image,
} from "./types";

// 说明：后端读接口直接返回数据库行（snake_case，bigint 序列化为字符串），
// 与 ./types 声明的 camelCase 不一致。这里在客户端统一做一次规范化
// （snake_case → camelCase，且 *id/*_id 的数字字符串转为 number），
// 属向后兼容的修正：不影响写接口（写接口本就接受 camelCase body）。

const ID_KEY = /^(id|.*_id)$/;

function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      let nv = normalize(v);
      if (ID_KEY.test(k) && typeof nv === "string" && /^\d+$/.test(nv)) {
        nv = Number(nv);
      }
      out[camelKey(k)] = nv;
    }
    return out;
  }
  return value;
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  const data = text ? normalize(JSON.parse(text)) : null;
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  me: () => request<SessionUser>("/api/me"),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  projects: {
    list: () => request<Project[]>("/api/projects"),
    create: (data: {
      name: string;
      description?: string;
      agentCanApprove?: boolean;
    }) =>
      request<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    get: (projectId: number) => request<Project>(`/api/projects/${projectId}`),
    update: (
      projectId: number,
      data: {
        name?: string;
        description?: string;
        agentCanApprove?: boolean;
      },
    ) =>
      request<Project>(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (projectId: number) =>
      request<{ ok: boolean }>(`/api/projects/${projectId}`, {
        method: "DELETE",
      }),
    members: (projectId: number) =>
      request<ProjectMember[]>(`/api/projects/${projectId}/members`),
    addMember: (
      projectId: number,
      data: {
        email: string;
        name?: string;
        password: string;
      },
    ) =>
      request<ProjectMember>(`/api/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    removeMember: (projectId: number, userId: string) =>
      request<{ ok: boolean }>(
        `/api/projects/${projectId}/members/${userId}`,
        { method: "DELETE" },
      ),
    apiKeys: (projectId: number) =>
      request<ApiKeyInfo[]>(`/api/projects/${projectId}/api-keys`),
    createApiKey: (projectId: number, name: string) =>
      request<ApiKeyInfo & { key: string }>(
        `/api/projects/${projectId}/api-keys`,
        { method: "POST", body: JSON.stringify({ name }) },
      ),
    revokeApiKey: (projectId: number, keyId: number) =>
      request<{ ok: boolean }>(
        `/api/projects/${projectId}/api-keys/${keyId}`,
        { method: "DELETE" },
      ),
  },

  topics: {
    list: (projectId: number) =>
      request<Topic[]>(`/api/projects/${projectId}/topics`),
    create: (
      projectId: number,
      data: { name: string; purpose?: string },
    ) =>
      request<Topic>(`/api/projects/${projectId}/topics`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    get: (topicId: number) => request<Topic>(`/api/topics/${topicId}`),
    update: (topicId: number, data: { name?: string; purpose?: string }) =>
      request<Topic>(`/api/topics/${topicId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (topicId: number) =>
      request<{ ok: boolean }>(`/api/topics/${topicId}`, { method: "DELETE" }),
  },

  users: {
    list: () => request<UserAccount[]>("/api/users"),
    projects: () =>
      request<{ id: number; name: string }[]>("/api/users/projects"),
    create: (data: {
      email: string;
      name?: string;
      password: string;
      role?: Role;
      assignments: { projectId: number }[];
    }) =>
      request<UserAccount>("/api/users", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    setRole: (userId: string, role: Role) =>
      request<{ id: string; role: Role }>(`/api/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    upsertMembership: (userId: string, data: { projectId: number }) =>
      request<UserMembership>(`/api/users/${userId}/memberships`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    removeMembership: (userId: string, projectId: number) =>
      request<{ ok: boolean }>(
        `/api/users/${userId}/memberships/${projectId}`,
        { method: "DELETE" },
      ),
    remove: (userId: string) =>
      request<{ ok: boolean }>(`/api/users/${userId}`, { method: "DELETE" }),
  },

  templates: {
    list: (
      projectId: number,
      filters: {
        tag?: string;
        q?: string;
        status?: string;
        topicId?: number;
      } = {},
    ) => {
      const qs = new URLSearchParams();
      if (filters.tag) qs.set("tag", filters.tag);
      if (filters.q) qs.set("q", filters.q);
      if (filters.status) qs.set("status", filters.status);
      if (filters.topicId) qs.set("topicId", String(filters.topicId));
      const suffix = qs.size ? `?${qs.toString()}` : "";
      return request<TemplateSummary[]>(
        `/api/projects/${projectId}/templates${suffix}`,
      );
    },
    create: (
      topicId: number,
      data: {
        name: string;
        purpose?: string;
        tags?: string[];
        html?: string;
        source?: string;
        note?: string;
      },
    ) =>
      request<{ template: TemplateSummary; version: Version | null }>(
        `/api/topics/${topicId}/templates`,
        { method: "POST", body: JSON.stringify(data) },
      ),
    get: (templateId: number) =>
      request<TemplateDetail>(`/api/templates/${templateId}`),
    update: (
      templateId: number,
      data: {
        name?: string;
        purpose?: string;
        tags?: string[];
        status?: "active" | "archived";
      },
    ) =>
      request<TemplateSummary>(`/api/templates/${templateId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (templateId: number) =>
      request<{ ok: boolean }>(`/api/templates/${templateId}`, {
        method: "DELETE",
      }),
    move: (templateId: number, topicId: number, copy = false) =>
      request<{ moved: boolean; templateId: number }>(
        `/api/templates/${templateId}/move`,
        { method: "POST", body: JSON.stringify({ topicId, copy }) },
      ),
    versions: (templateId: number, limit = 100) =>
      request<Version[]>(
        `/api/templates/${templateId}/versions?limit=${limit}`,
      ),
    pushVersion: (
      templateId: number,
      data: { html: string; source?: string; note?: string; status?: string },
    ) =>
      request<Version>(`/api/templates/${templateId}/versions`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    approve: (templateId: number, versionId: number) =>
      request<Version>(
        `/api/templates/${templateId}/versions/${versionId}/approve`,
        { method: "POST" },
      ),
    rollback: (templateId: number, versionId: number) =>
      request<Version>(
        `/api/templates/${templateId}/versions/${versionId}/rollback`,
        { method: "POST" },
      ),
  },

  images: {
    list: (projectId: number) =>
      request<Image[]>(`/api/projects/${projectId}/images`),
    upload: (projectId: number, file: File, name?: string) =>
      uploadImage<Image>(projectId, file, name),
    remove: (imageId: number) =>
      request<{ ok: boolean }>(`/api/images/${imageId}`, { method: "DELETE" }),
    rename: (imageId: number, name: string) =>
      request<{ id: number; name: string; url: string }>(
        `/api/images/${imageId}`,
        { method: "PATCH", body: JSON.stringify({ name }) },
      ),
  },
};

/** 上传图片（multipart，不能复用 JSON 的 request 助手）。 */
async function uploadImage<T>(
  projectId: number,
  file: File,
  name?: string,
): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  const res = await fetch(`/api/projects/${projectId}/images`, {
    method: "POST",
    body: form,
  });
  const text = await res.text();
  const data = text ? normalize(JSON.parse(text)) : null;
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `上传失败（${res.status}）`;
    throw new Error(message);
  }
  return data as T;
}

/** 版本截图 URL（需要登录 cookie；agent 可用 Bearer key）。 */
export function screenshotUrl(versionId: number, kind: "desktop" | "mobile") {
  return `/api/versions/${versionId}/screenshots/${kind}`;
}

/** 图片原图 URL（需要登录 cookie；agent 可用 Bearer key）。 */
export function imageUrl(imageId: number) {
  return `/api/images/${imageId}`;
}
