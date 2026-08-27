"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ErrorText, Spinner, btnSecondary, inputCls } from "@/components/ui";

type OpenApiSchema = {
  type?: string;
  format?: string;
  description?: string;
  enum?: Array<string | number>;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
};

type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
};

type OpenApiRequestBody = {
  required?: boolean;
  content?: Record<string, { schema?: OpenApiSchema }>;
};

type OpenApiOperation = {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, { description?: string }>;
};

type OpenApiDocument = {
  info?: {
    title?: string;
    description?: string;
  };
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    securitySchemes?: Record<
      string,
      { type?: string; in?: string; name?: string; description?: string }
    >;
  };
};

type Endpoint = {
  method: string;
  path: string;
  operation: OpenApiOperation;
  group: string;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const METHOD_STYLES: Record<string, string> = {
  get: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  post: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  patch: "bg-amber-50 text-amber-700 ring-amber-200",
  delete: "bg-rose-50 text-rose-700 ring-rose-200",
};

const GROUP_META: Array<{
  key: string;
  title: string;
  hint: string;
}> = [
  {
    key: "discover",
    title: "发现与列表",
    hint: "获取项目内的主题与模板",
  },
  {
    key: "versions",
    title: "版本与任务",
    hint: "读取历史、提交版本、采纳与截图",
  },
  {
    key: "images",
    title: "图片资源",
    hint: "上传、读取和管理项目图片",
  },
  {
    key: "other",
    title: "其他",
    hint: "其他供 AI 客户端使用的接口",
  },
];

function groupKey(path: string): string {
  if (path.includes("/api/projects/{projectId}/topics")) return "discover";
  if (path === "/api/projects/{projectId}/templates") return "discover";
  if (path.includes("/versions") || path.includes("/approve")) return "versions";
  if (path.includes("/images")) return "images";
  return "other";
}

function schemaType(schema?: OpenApiSchema): string {
  if (!schema) return "—";
  const parts = [schema.type ?? "object"];
  if (schema.format) parts.push(schema.format);
  if (schema.enum?.length) parts.push(schema.enum.map(String).join(" | "));
  return parts.join(" · ");
}

function bodyFields(body: OpenApiRequestBody): {
  contentType: string;
  required: boolean;
  fields: Array<{ name: string; required: boolean; schema: OpenApiSchema }>;
} {
  const contentType = Object.keys(body.content ?? {})[0] ?? "请求体";
  const schema = body.content?.[contentType]?.schema;
  const required = body.required ?? false;
  if (schema?.type !== "object" || !schema.properties) {
    return { contentType, required, fields: [] };
  }
  const fields = Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    required: schema.required?.includes(name) ?? false,
    schema: prop,
  }));
  return { contentType, required, fields };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
    >
      {copied ? "已复制" : "复制路径"}
    </button>
  );
}

function ParameterTable({ parameters }: { parameters: OpenApiParameter[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-100">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2 font-medium">参数</th>
            <th className="px-3 py-2 font-medium">位置</th>
            <th className="px-3 py-2 font-medium">类型</th>
            <th className="px-3 py-2 font-medium">必填</th>
            <th className="px-3 py-2 font-medium">说明</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {parameters.map((param) => (
            <tr key={`${param.in}-${param.name}`} className="align-top">
              <td className="px-3 py-2">
                <code className="font-mono text-[13px] text-slate-800">
                  {param.name}
                </code>
              </td>
              <td className="px-3 py-2 text-slate-500">{param.in}</td>
              <td className="px-3 py-2">
                <code className="font-mono text-xs text-slate-600">
                  {schemaType(param.schema)}
                </code>
              </td>
              <td className="px-3 py-2">
                {param.required ? (
                  <span className="font-medium text-rose-600">必填</span>
                ) : (
                  <span className="text-slate-400">可选</span>
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">
                {param.description ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BodyPanel({ body }: { body: OpenApiRequestBody }) {
  const { contentType, required, fields } = bodyFields(body);

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-slate-400">
          请求体
        </span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600">
          {contentType}
        </span>
        {required ? (
          <span className="font-medium text-rose-600">必填</span>
        ) : (
          <span className="text-slate-400">可选</span>
        )}
      </div>

      {fields.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 font-medium">字段</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">必填</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fields.map((field) => (
                <tr key={field.name} className="align-top">
                  <td className="px-3 py-2">
                    <code className="font-mono text-[13px] text-slate-800">
                      {field.name}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    <code className="font-mono text-xs text-slate-600">
                      {schemaType(field.schema)}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    {field.required ? (
                      <span className="font-medium text-rose-600">必填</span>
                    ) : (
                      <span className="text-slate-400">可选</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {field.schema.description ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{contentType} 请求体</p>
      )}
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const { method, path, operation } = endpoint;
  const methodCls =
    METHOD_STYLES[method.toLowerCase()] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  const successStatuses = Object.entries(operation.responses ?? {})
    .filter(([status]) => status.startsWith("2"))
    .map(([status, response]) => `${status} ${response.description ?? ""}`.trim());

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <span
          className={`inline-flex w-16 justify-center rounded-md px-2 py-1 text-xs font-bold uppercase ring-1 ring-inset ${methodCls}`}
        >
          {method}
        </span>
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-slate-800">
          {path}
        </code>
        <CopyButton text={path} />
      </div>

      <div className="p-4">
        {operation.summary ? (
          <p className="text-sm font-semibold text-slate-800">
            {operation.summary}
          </p>
        ) : null}
        {operation.description ? (
          <p className="mt-1 text-sm text-slate-500">{operation.description}</p>
        ) : null}

        {operation.parameters && operation.parameters.length > 0 ? (
          <ParameterTable parameters={operation.parameters} />
        ) : null}

        {operation.requestBody ? <BodyPanel body={operation.requestBody} /> : null}

        {successStatuses.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              成功响应
            </span>
            {successStatuses.map((status) => (
              <span
                key={status}
                className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-xs text-emerald-700"
              >
                {status}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function ApiToolsContent() {
  const [doc, setDoc] = useState<OpenApiDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/openapi.json");
      if (!res.ok) throw new Error(`加载失败（${res.status}）`);
      setDoc((await res.json()) as OpenApiDocument);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const endpoints = useMemo<Endpoint[]>(() => {
    const list: Endpoint[] = [];
    for (const [path, pathItem] of Object.entries(doc?.paths ?? {})) {
      for (const [method, operation] of Object.entries(pathItem ?? {})) {
        if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
        list.push({
          method,
          path,
          operation,
          group: groupKey(path),
        });
      }
    }
    return list;
  }, [doc]);

  const grouped = useMemo(
    () =>
      GROUP_META.map((meta) => ({
        ...meta,
        endpoints: endpoints.filter((endpoint) => endpoint.group === meta.key),
      })).filter((group) => group.endpoints.length > 0),
    [endpoints],
  );

  const filteredGroups = keyword.trim()
    ? grouped
        .map((group) => ({
          ...group,
          endpoints: group.endpoints.filter(({ method, path, operation }) =>
            `${method} ${path} ${operation.summary ?? ""}`
              .toLowerCase()
              .includes(keyword.trim().toLowerCase()),
          ),
        }))
        .filter((group) => group.endpoints.length > 0)
    : grouped;

  if (error && !doc) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-lg font-semibold text-slate-900">API 工具</h1>
        <ErrorText message={error} />
        <button
          type="button"
          className={`${btnSecondary} mt-3`}
          onClick={() => void load()}
        >
          重试
        </button>
      </div>
    );
  }

  if (!doc) return <Spinner />;

  const authScheme = doc.components?.securitySchemes?.ApiKeyAuth;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">API 工具</h1>
          <p className="mt-1 text-sm text-slate-500">
            面向 AI 客户端的接口清单 · 共 {endpoints.length} 个接口
          </p>
        </div>
        <Link href="/openapi.json" target="_blank" className={btnSecondary}>
          查看 OpenAPI JSON
        </Link>
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/70">
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-sm font-semibold text-indigo-900">认证方式</p>
            <p className="mt-1 text-sm text-indigo-800">
              {authScheme?.description ??
                "在项目设置中创建 API key，并在请求头中携带 Bearer 令牌"}
            </p>
            <p className="mt-2 text-xs text-indigo-700">
              API key 绑定所属项目，只能访问该项目内的主题、模板、版本与图片。
            </p>
          </div>
          <code className="block self-center overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
            Authorization: Bearer edm_&lt;API_KEY&gt;
          </code>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          className={`${inputCls} max-w-md`}
          placeholder="搜索接口（方法 / 路径 / 说明）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {keyword.trim() ? (
          <span className="text-xs text-slate-400">
            找到 {filteredGroups.reduce((sum, group) => sum + group.endpoints.length, 0)}{" "}
            个接口
          </span>
        ) : null}
      </div>

      {filteredGroups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center text-sm text-slate-400">
          没有匹配的接口
        </p>
      ) : (
        <div className="space-y-8">
          {filteredGroups.map((group) => (
            <section key={group.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  {group.title}
                </h2>
                <span className="text-xs text-slate-400">
                  {group.endpoints.length} 个接口
                </span>
                <span className="hidden text-xs text-slate-400 sm:inline">
                  · {group.hint}
                </span>
              </div>
              <div className="space-y-3">
                {group.endpoints.map((endpoint) => (
                  <EndpointCard
                    key={`${endpoint.method}-${endpoint.path}`}
                    endpoint={endpoint}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">
        创建主题和模板仍仅限登录用户；上方仅列出 AI 客户端可调用的接口。
      </p>
    </div>
  );
}
