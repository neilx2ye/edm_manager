"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { api } from "@/lib/client-api";
import type { Project, Role, Topic } from "@/lib/types";
import {
  ErrorText,
  Field,
  Modal,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui";

export default function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: Role };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 当前项目：优先 ?projectId=，其次 /projects/<id>/... 路径（设置页无 query）
  const queryProjectId = Number(searchParams.get("projectId")) || null;
  const pathMatch = pathname.match(/^\/projects\/(\d+)/);
  const currentProjectId = queryProjectId ?? (pathMatch ? Number(pathMatch[1]) : null);
  const currentTopicId = Number(searchParams.get("topicId")) || null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await api.projects.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  // 加载当前项目的主题列表
  useEffect(() => {
    if (!currentProjectId) {
      setTopics([]);
      return;
    }
    let cancelled = false;
    api.topics
      .list(currentProjectId)
      .then((list) => {
        if (!cancelled) setTopics(list);
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId, pathname]);

  const currentProject =
    projects.find((p) => p.id === currentProjectId) ?? null;

  function switchProject(id: number) {
    setSwitcherOpen(false);
    router.push(`/templates?projectId=${id}`);
  }

  const onTemplatesList = pathname === "/templates";
  const onSettings = pathname === `/projects/${currentProjectId}/settings`;
  const onImages = pathname === "/images";
  const onApiTools = pathname === "/api-tools";

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* 最顶端：项目切换下拉框 */}
      <div className="relative border-b border-slate-200 p-3">
        <button
          type="button"
          onClick={() => setSwitcherOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 px-3 py-2 text-left hover:border-indigo-400"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-900">
              {currentProject?.name ?? "选择项目"}
            </span>
            <span className="mt-0.5 block text-[11px] text-slate-400">
              项目 = 工作区
            </span>
          </span>
          <span
            className={`shrink-0 text-slate-400 transition-transform ${
              switcherOpen ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </button>

        {switcherOpen ? (
          <>
            {/* 点击外部关闭 */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setSwitcherOpen(false)}
            />
            <div className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <div className="max-h-64 overflow-y-auto p-1">
                {projects.map((p) => {
                  const active = p.id === currentProjectId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => switchProject(p.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                        active
                          ? "bg-indigo-50 font-medium text-indigo-700"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                    </button>
                  );
                })}
                {projects.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-400">暂无项目</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSwitcherOpen(false);
                  setShowCreate(true);
                }}
                className="w-full border-t border-slate-200 px-3 py-2 text-left text-sm text-indigo-600 hover:bg-indigo-50"
              >
                ＋ 新建项目
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* 功能导航 */}
      <div className="flex-1 overflow-y-auto p-2">
        <ErrorText message={error} />
        {!currentProjectId ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">
            请先选择项目
          </p>
        ) : (
          <>
            {/* 主题分组 */}
            <div className="mb-1">
              <button
                type="button"
                onClick={() => setTopicsOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100"
              >
                <span>主题</span>
                <span
                  className={`transition-transform ${topicsOpen ? "" : "-rotate-90"}`}
                >
                  ▾
                </span>
              </button>
              {topicsOpen ? (
                <div className="mt-0.5">
                  <Link
                    href={`/templates?projectId=${currentProjectId}`}
                    className={`mb-0.5 flex items-center justify-between gap-2 rounded-lg pl-6 pr-3 py-2 text-sm ${
                      onTemplatesList && currentTopicId === null
                        ? "bg-indigo-50 font-medium text-indigo-700"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="truncate">全部模板</span>
                  </Link>
                  {topics.length === 0 ? (
                    <p className="pl-6 pr-3 py-2 text-sm text-slate-400">暂无主题</p>
                  ) : (
                    topics.map((t) => {
                      const active = onTemplatesList && currentTopicId === t.id;
                      return (
                        <Link
                          key={t.id}
                          href={`/templates?projectId=${currentProjectId}&topicId=${t.id}`}
                          className={`mb-0.5 flex items-center justify-between gap-2 rounded-lg pl-6 pr-3 py-2 text-sm ${
                            active
                              ? "bg-indigo-50 font-medium text-indigo-700"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          <span className="truncate">{t.name}</span>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] leading-none ${
                              active
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {t.templateCount}
                          </span>
                        </Link>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>

            {/* API 工具 */}
            <Link
              href={`/api-tools?projectId=${currentProjectId}`}
              className={`mb-0.5 block rounded-lg px-3 py-2 text-sm ${
                onApiTools
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              API 工具
            </Link>

            {/* 设置 */}
            <Link
              href={`/projects/${currentProjectId}/settings`}
              className={`mb-0.5 block rounded-lg px-3 py-2 text-sm ${
                onSettings
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              设置
            </Link>
            <Link
              href={`/images?projectId=${currentProjectId}`}
              className={`mb-0.5 block rounded-lg px-3 py-2 text-sm ${
                onImages
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              🖼️ 图片库
            </Link>
          </>
        )}
      </div>

      {/* 底部：用户信息 + 用户管理 + 退出登录 */}
      <div className="border-t border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">
              {user.name}
            </p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-rose-600"
          >
            退出
          </button>
        </div>
        {user.role === "admin" ? (
          <Link
            href="/users"
            className={`block rounded-lg px-2 py-1.5 text-sm ${
              pathname === "/users"
                ? "bg-indigo-50 font-medium text-indigo-700"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            👥 用户管理
          </Link>
        ) : null}
      </div>

      {showCreate ? (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(p) => {
            setShowCreate(false);
            void load();
            router.push(`/templates?projectId=${p.id}`);
          }}
        />
      ) : null}
    </aside>
  );
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentCanApprove, setAgentCanApprove] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const p = await api.projects.create({
        name,
        description: description || undefined,
        agentCanApprove,
      });
      onCreated(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <Modal title="新建项目" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="项目名称">
          <input
            required
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="描述（可选）">
          <textarea
            rows={2}
            className={inputCls}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={agentCanApprove}
            onChange={(e) => setAgentCanApprove(e.target.checked)}
          />
          允许 agent 自动采纳版本（agentCanApprove）
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
