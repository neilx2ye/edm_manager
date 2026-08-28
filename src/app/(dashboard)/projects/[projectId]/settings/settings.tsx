"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import type { ApiKeyInfo, Project, Topic } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { TopicFormModal } from "@/components/topics";
import {
  ConfirmDialog,
  ErrorText,
  Field,
  Modal,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui";

type Tab = "general" | "topics" | "apikeys";

export default function ProjectSettings({
  projectId,
  initialTab = "general",
}: {
  projectId: number;
  initialTab?: Tab;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // 后端无 GET /api/projects/:id，用列表接口查找
      const projects = await api.projects.list();
      const found = projects.find((p) => p.id === projectId);
      if (!found) throw new Error("项目不存在或无权限访问");
      setProject(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!project) {
    return error ? (
      <div className="p-8">
        <ErrorText message={error} />
      </div>
    ) : (
      <Spinner />
    );
  }

  const canManage = Boolean(project);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900">
          项目设置 · {project.name}
        </h1>
        <Link
          href={`/templates?projectId=${project.id}`}
          className="text-xs text-indigo-600 hover:underline"
        >
          ← 返回模板列表
        </Link>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ["general", "通用"],
            ["topics", "主题"],
            ["apikeys", "API key"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === key
                ? "border border-b-0 border-slate-200 bg-white text-indigo-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "general" ? (
        <GeneralSettings project={project} canManage={canManage} onSaved={load} />
      ) : tab === "topics" ? (
        <TopicsTab projectId={projectId} canManage={canManage} />
      ) : (
        <ApiKeysTab projectId={projectId} canManage={canManage} />
      )}
    </div>
  );
}

/* ---------- 通用设置 ---------- */

function GeneralSettings({
  project,
  canManage,
  onSaved,
}: {
  project: Project;
  canManage: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [agentCanApprove, setAgentCanApprove] = useState(
    project.agentCanApprove,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      await api.projects.update(project.id, {
        name,
        description,
        agentCanApprove,
      });
      setMsg("已保存");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject() {
    setError(null);
    setDeleting(true);
    try {
      await api.projects.remove(project.id);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setConfirmDelete(false);
      setDeleting(false);
    }
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-slate-800">通用设置</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="项目名称">
            <input
              required
              disabled={!canManage}
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="描述">
            <input
              disabled={!canManage}
              className={inputCls}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            disabled={!canManage}
            checked={agentCanApprove}
            onChange={(e) => setAgentCanApprove(e.target.checked)}
          />
          允许 agent 自动采纳版本（agentCanApprove）
        </label>
        {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
        <ErrorText message={error} />
        {canManage ? (
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "保存中…" : "保存"}
          </button>
        ) : null}
      </form>

      {project.isOwner ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-rose-700">危险区域</h2>
          <p className="mt-1 text-xs text-slate-500">
            删除项目会同时删除其下的所有主题、模板、版本、成员与 API key，此操作无法恢复。
          </p>
          <button
            type="button"
            disabled={deleting}
            onClick={() => setConfirmDelete(true)}
            className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            删除项目
          </button>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="删除项目"
          message={`确定要删除项目「${project.name}」吗？其下所有主题、模板与版本都会被删除，且无法恢复。`}
          confirmLabel="删除项目"
          busy={deleting}
          onConfirm={() => void deleteProject()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  );
}

/* ---------- 主题 ---------- */

function TopicsTab({
  projectId,
  canManage,
}: {
  projectId: number;
  canManage: boolean;
}) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [removing, setRemoving] = useState<Topic | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTopics(await api.topics.list(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeTopic(t: Topic) {
    setError(null);
    setBusy(true);
    try {
      await api.topics.remove(t.id);
      setRemoving(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <ErrorText message={error} />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">名称</th>
              <th className="px-4 py-2 font-medium">用途</th>
              <th className="px-4 py-2 font-medium">模板数</th>
              {canManage ? (
                <th className="px-4 py-2 font-medium">操作</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {topics.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-slate-400"
                >
                  暂无主题
                </td>
              </tr>
            ) : (
              topics.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 text-slate-800">{t.name}</td>
                  <td className="px-4 py-2 text-slate-600">{t.purpose ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600">{t.templateCount}</td>
                  {canManage ? (
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        className="mr-3 text-xs text-indigo-600 hover:underline"
                        onClick={() => setEditing(t)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="text-xs text-rose-600 hover:underline"
                        onClick={() => setRemoving(t)}
                      >
                        删除
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <button
          type="button"
          className={btnPrimary}
          onClick={() => setShowCreate(true)}
        >
          + 新建主题
        </button>
      ) : null}

      {showCreate ? (
        <TopicFormModal
          projectId={projectId}
          topic={null}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            void load();
          }}
        />
      ) : null}

      {editing ? (
        <TopicFormModal
          projectId={projectId}
          topic={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="删除主题"
          message={`确认删除主题「${removing.name}」？${
            removing.templateCount > 0
              ? `该主题下仍有 ${removing.templateCount} 个模板，需先移出或删除。`
              : "该主题下没有模板，可安全删除。"
          }`}
          confirmLabel="删除"
          busy={busy}
          onConfirm={() => void removeTopic(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

/* ---------- API key ---------- */

function ApiKeysTab({
  projectId,
  canManage,
}: {
  projectId: number;
  canManage: boolean;
}) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<ApiKeyInfo | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setKeys(await api.projects.apiKeys(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey(e: FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (new FormData(form).get("name") as string).trim();
    if (!name) return;
    setError(null);
    try {
      const k = await api.projects.createApiKey(projectId, name);
      setNewKey(k);
      setCopied(false);
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function revoke(k: ApiKeyInfo) {
    setError(null);
    try {
      await api.projects.revokeApiKey(projectId, k.id);
      setRevoking(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤销失败");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <ErrorText message={error} />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">名称</th>
              <th className="px-4 py-2 font-medium">创建时间</th>
              <th className="px-4 py-2 font-medium">最近使用</th>
              <th className="px-4 py-2 font-medium">状态</th>
              {canManage ? (
                <th className="px-4 py-2 font-medium">操作</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-sm text-slate-400"
                >
                  暂无 API key
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 text-slate-800">{k.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">
                    {formatDateTime(k.createdAt)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">
                    {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "从未使用"}
                  </td>
                  <td className="px-4 py-2">
                    {k.revokedAt ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        已撤销
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                        有效
                      </span>
                    )}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2">
                      {!k.revokedAt ? (
                        <button
                          type="button"
                          className="text-xs text-rose-600 hover:underline"
                          onClick={() => setRevoking(k)}
                        >
                          撤销
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <form onSubmit={createKey} className="flex gap-2">
          <input
            name="name"
            required
            placeholder="key 名称，如 ci-agent"
            className={`${inputCls} w-64`}
          />
          <button type="submit" className={btnPrimary}>
            新建 API key
          </button>
        </form>
      ) : null}

      {newKey?.key ? (
        <Modal title="API key 已创建" onClose={() => setNewKey(null)}>
          <p className="mb-2 text-sm text-slate-600">
            明文 key 仅展示这一次，请立即复制保存：
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-900">
              {newKey.key}
            </code>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                void navigator.clipboard.writeText(newKey.key!);
                setCopied(true);
              }}
            >
              {copied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <p className="mb-1 mt-4 text-sm font-medium text-slate-700">
            agent 使用示例：
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
{`curl -X POST "$HOST/api/templates/<templateId>/versions" \\
  -H "Authorization: Bearer ${newKey.key}" \\
  -H "Content-Type: application/json" \\
  -d '{"html": "<html>…</html>", "note": "agent 提交"}'`}
          </pre>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => setNewKey(null)}
            >
              我已保存
            </button>
          </div>
        </Modal>
      ) : null}

      {revoking ? (
        <ConfirmDialog
          title="撤销 API key"
          message={`确认撤销「${revoking.name}」？撤销后该 key 立即失效。`}
          confirmLabel="撤销"
          onConfirm={() => void revoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      ) : null}
    </div>
  );
}
