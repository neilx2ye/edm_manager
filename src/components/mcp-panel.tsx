"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import type { ApiKeyInfo } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { MCP_TOOL_META } from "@/mcp/tool-meta";
import {
  ErrorText,
  Field,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui";

type Transport = "http" | "stdio";

function CopyButton({
  text,
  label = "复制",
  copied,
  onCopy,
}: {
  text: string;
  label?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button type="button" onClick={onCopy} className={btnSecondary}>
      {copied ? "已复制 ✓" : label}
    </button>
  );
}

export function McpPanel({
  projectId,
  canManage = false,
}: {
  projectId: number;
  canManage?: boolean;
}) {
  const [origin, setOrigin] = useState("");
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [keyName, setKeyName] = useState("MCP client");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>("http");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      setKeys(await api.projects.apiKeys(projectId));
    } catch {
      setKeys([]);
    } finally {
      setKeysLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    setKeysLoaded(false);
    setCreatedKey(null);
    setShowCreate(false);
    void loadKeys();
  }, [loadKeys, projectId]);

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  async function createKey(event: FormEvent) {
    event.preventDefault();
    const name = keyName.trim();
    if (!name) {
      setError("key 名称不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.projects.createApiKey(projectId, name);
      setCreatedKey(created.key ?? null);
      setShowCreate(false);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  const endpoint = `${origin || "https://edm.neilx.online"}/api/mcp`;
  const token = createdKey ?? "edm_<API_KEY>";
  const baseUrl = origin || "https://edm.neilx.online";

  const hostedConfig = `{
  "mcpServers": {
    "edm": {
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`;

  const stdioConfig = `{
  "mcpServers": {
    "edm": {
      "command": "/home/ubuntu/EDM/node_modules/.bin/tsx",
      "args": ["/home/ubuntu/EDM/mcp/stdio.ts"],
      "env": {
        "EDM_API_KEY": "${token}",
        "EDM_API_BASE_URL": "${baseUrl}"
      }
    }
  }
}`;

  const config = transport === "http" ? hostedConfig : stdioConfig;
  const activeKeyCount = keys.length;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
              MCP
            </span>
            <h2 className="mt-2 text-base font-semibold text-slate-900">
              MCP 接入
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              让 Codex、Claude Desktop、Cursor 等客户端以原生工具调用方式操作本项目的
              主题、模板、版本与图片。创建主题/模板、回滚版本仍仅限登录用户。
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            {keysLoaded ? `${activeKeyCount} 个有效 key` : "读取 key 中…"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">Server URL</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-slate-900">
                {endpoint}
              </code>
              <CopyButton
                text={endpoint}
                copied={copied === "endpoint"}
                onCopy={() => void copyText("endpoint", endpoint)}
              />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">认证方式</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-slate-900">
                Authorization: Bearer {token}
              </code>
              <CopyButton
                text={`Authorization: Bearer ${token}`}
                copied={copied === "auth"}
                onCopy={() =>
                  void copyText("auth", `Authorization: Bearer ${token}`)
                }
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">1. 准备 API key</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              托管 MCP 与 stdio MCP 都使用项目 API key 认证。
            </p>
          </div>
          {canManage && !showCreate ? (
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setShowCreate(true)}
            >
              创建新的 MCP key
            </button>
          ) : null}
        </div>

        <ErrorText message={error} />

        {createdKey ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-amber-900">
                API key 已创建
              </p>
              <p className="text-xs text-amber-700">明文只显示这一次</p>
            </div>
            <div className="mt-2 flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-white px-3 py-2 font-mono text-sm text-slate-900">
                {createdKey}
              </code>
              <CopyButton
                text={createdKey}
                label="复制 key"
                copied={copied === "created-key"}
                onCopy={() => void copyText("created-key", createdKey)}
              />
            </div>
            <p className="mt-2 text-xs text-amber-700">
              下方配置已自动填入该 key，请立即复制保存；刷新页面后不再显示。
            </p>
          </div>
        ) : activeKeyCount > 0 ? (
          <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            已有 {activeKeyCount} 个有效 key。明文无法再次查看，请使用你保存的 key，
            或创建新的 MCP key。
          </div>
        ) : keysLoaded ? (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            还没有可用的 API key。{canManage ? "请在下方创建。" : "请联系项目管理员创建。"}
          </div>
        ) : null}

        {canManage && showCreate ? (
          <form onSubmit={createKey} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Key 名称">
              <input
                className={`${inputCls} w-64`}
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="例如 codex-mcp"
              />
            </Field>
            <button type="submit" className={btnPrimary} disabled={busy}>
              {busy ? "创建中…" : "创建并填入配置"}
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setShowCreate(false)}
            >
              取消
            </button>
          </form>
        ) : null}

        {activeKeyCount > 0 ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">创建时间</th>
                  <th className="px-3 py-2 font-medium">最近使用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td className="px-3 py-2 text-slate-700">{key.name}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {formatDateTime(key.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "从未使用"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              2. 配置 MCP 客户端
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              选择托管 MCP（无需本机 Node）或 stdio（可读取本地图片文件）。
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                ["http", "托管 MCP"],
                ["stdio", "stdio 本机"],
              ] as [Transport, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTransport(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  transport === key
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {transport === "http"
            ? "推荐。MCP 请求经 HTTPS 直达 EDM；图片需用 data_base64 传入，单张 ≤ 10 MB。"
            : "适合本机客户端。edm_upload_image 支持 file_path 直接读取本机图片。"}
        </p>

        <div className="mt-2 flex justify-end">
          <CopyButton
            text={config}
            label="复制配置"
            copied={copied === "config"}
            onCopy={() => void copyText("config", config)}
          />
        </div>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
          {config}
        </pre>
        {!createdKey ? (
          <p className="mt-2 text-xs text-slate-400">
            配置中的 <code>edm_&lt;API_KEY&gt;</code> 请替换为你保存的 key。
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">3. 验证连接</h3>
        <p className="mt-1 text-sm text-slate-600">
          连接成功后，让客户端调用 <code className="font-mono">edm_get_context</code>
          {" "}确认项目和 key 信息。共提供 {MCP_TOOL_META.length} 个工具：
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MCP_TOOL_META.map((tool) => (
            <div
              key={tool.name}
              className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5"
            >
              <code className="font-mono text-[11px] font-semibold text-indigo-700">
                {tool.name}
              </code>
              <p className="mt-0.5 text-xs font-medium text-slate-700">
                {tool.label}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                {tool.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
