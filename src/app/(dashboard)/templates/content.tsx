"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, screenshotUrl } from "@/lib/client-api";
import type { Project, TemplateSummary, Topic } from "@/lib/types";
import { TopicFormModal } from "@/components/topics";
import {
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Modal,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui";

export default function TemplatesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = Number(searchParams.get("projectId")) || null;
  // 主题选择由左侧栏承担，本页直接消费 ?topicId=
  const topicId = Number(searchParams.get("topicId")) || null;

  const [project, setProject] = useState<Project | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [removing, setRemoving] = useState<TemplateSummary | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 后端无 GET /api/projects/:id，用列表接口查找
      const [projects, topicList, list] = await Promise.all([
        api.projects.list(),
        api.topics.list(projectId),
        api.templates.list(projectId),
      ]);
      setProject(projects.find((p) => p.id === projectId) ?? null);
      setTopics(topicList);
      setTemplates(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 切换项目或主题时清空选择，避免把上一个列表的选择带过来
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [projectId, topicId]);

  // 当前选中的主题被删除后回退到「全部模板」
  useEffect(() => {
    if (
      projectId &&
      topicId !== null &&
      !loading &&
      !topics.some((t) => t.id === topicId)
    ) {
      router.replace(`/templates?projectId=${projectId}`);
    }
  }, [projectId, topicId, topics, loading, router]);

  // 仅按左侧栏选择的主题 ?topicId= 过滤
  const filtered = useMemo(
    () =>
      topicId === null
        ? templates
        : templates.filter((t) => t.topicId === topicId),
    [templates, topicId],
  );

  if (!projectId) {
    return (
      <div className="p-8">
        <EmptyState
          title="未选择项目"
          hint="请从左上角选择项目"
        />
      </div>
    );
  }
  if (loading) return <Spinner />;

  const activeTopic = topics.find((t) => t.id === topicId) ?? null;
  const canDelete = project?.myRole === "admin";
  const allSelected =
    canDelete &&
    filtered.length > 0 &&
    filtered.every((t) => selectedIds.has(t.id));

  function toggleTemplate(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((t) => t.id)));
  }

  function toggleSelectionMode() {
    const next = !selectionMode;
    setSelectionMode(next);
    if (!next) setSelectedIds(new Set());
  }

  async function deleteTemplateIds(ids: number[]): Promise<boolean> {
    setError(null);
    setDeleteBusy(true);
    const results = await Promise.allSettled(
      ids.map((id) => api.templates.remove(id)),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      const messages = failures.map((failure) =>
        failure.reason instanceof Error ? failure.reason.message : "删除失败",
      );
      setError(
        messages.length === 1
          ? messages[0]
          : `部分模板删除失败：${messages.join("；")}`,
      );
      setDeleteBusy(false);
      return false;
    }
    setSelectedIds(new Set());
    await load();
    setDeleteBusy(false);
    return true;
  }

  async function confirmSingleDelete() {
    if (!removing) return;
    const ok = await deleteTemplateIds([removing.id]);
    if (ok) setRemoving(null);
  }

  async function confirmBatchDelete() {
    const ok = await deleteTemplateIds([...selectedIds]);
    if (ok) {
      setBatchConfirmOpen(false);
      setSelectionMode(false);
    }
  }

  return (
    <div className="p-6">
      {/* 工具栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {project?.name ?? "模板列表"}
          </h1>
          {project ? (
            <Link
              href={`/projects/${project.id}/settings`}
              className="text-xs text-indigo-600 hover:underline"
            >
              项目设置 →
            </Link>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setShowCreateTopic(true)}
          >
            + 主题
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={topics.length === 0}
            title={topics.length === 0 ? "请先创建主题" : undefined}
            onClick={() => setShowCreate(true)}
          >
            + 新建模板
          </button>
          {canDelete && filtered.length > 0 ? (
            <button
              type="button"
              className={selectionMode ? btnSecondary : btnDanger}
              onClick={toggleSelectionMode}
            >
              {selectionMode ? "退出批量删除" : "批量删除"}
            </button>
          ) : null}
        </div>
      </div>

      {/* 主题筛选由左侧栏承担（?topicId=），此处不再渲染横向 tab */}

      <ErrorText message={error} />

      {selectionMode && filtered.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={allSelected}
              onChange={toggleAll}
            />
            全选
          </label>
          <span className="text-xs text-slate-400">
            {selectedIds.size > 0
              ? `已选 ${selectedIds.size} 个模板`
              : "勾选模板后可批量删除"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={btnSecondary}
              onClick={toggleSelectionMode}
            >
              取消
            </button>
            <button
              type="button"
              className={btnDanger}
              disabled={selectedIds.size === 0 || deleteBusy}
              onClick={() => setBatchConfirmOpen(true)}
            >
              删除选中{selectedIds.size > 0 ? `（${selectedIds.size}）` : ""}
            </button>
          </div>
        </div>
      ) : null}

      {/* 卡片网格 */}
      {topics.length === 0 ? (
        <EmptyState title="还没有主题" hint="先创建主题，再在主题下创建模板">
          <button
            type="button"
            className={`${btnPrimary} mt-2`}
            onClick={() => setShowCreateTopic(true)}
          >
            创建第一个主题
          </button>
        </EmptyState>
      ) : templates.length === 0 ? (
        <EmptyState title="还没有模板" hint="创建第一个模板开始迭代">
          <button
            type="button"
            className={`${btnPrimary} mt-2`}
            onClick={() => setShowCreate(true)}
          >
            创建第一个模板
          </button>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={activeTopic ? `「${activeTopic.name}」下暂无模板` : "没有模板"}
          hint={activeTopic ? "可在该主题下创建模板，或在左侧栏切换主题" : "请选择主题或创建模板"}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              checkboxVisible={selectionMode}
              deleteVisible={canDelete && !selectionMode}
              selected={selectedIds.has(t.id)}
              onToggle={() => toggleTemplate(t.id)}
              onDelete={() => setRemoving(t)}
            />
          ))}
        </div>
      )}

      {showCreate ? (
        <CreateTemplateModal
          projectId={projectId}
          topics={topics}
          defaultTopicId={topicId}
          onClose={() => setShowCreate(false)}
        />
      ) : null}

      {showCreateTopic && projectId ? (
        <TopicFormModal
          projectId={projectId}
          topic={null}
          onClose={() => setShowCreateTopic(false)}
          onSaved={(t) => {
            setShowCreateTopic(false);
            void load();
            router.push(`/templates?projectId=${projectId}&topicId=${t.id}`);
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="删除模板"
          message={`确认删除模板「${removing.name}」吗？其所有版本与截图都会被永久删除，且无法恢复。`}
          confirmLabel="删除"
          busy={deleteBusy}
          onConfirm={() => void confirmSingleDelete()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}

      {batchConfirmOpen ? (
        <ConfirmDialog
          title="批量删除模板"
          message={`确认删除选中的 ${selectedIds.size} 个模板吗？这些模板的所有版本与截图都会被永久删除，且无法恢复。`}
          confirmLabel="批量删除"
          busy={deleteBusy}
          onConfirm={() => void confirmBatchDelete()}
          onCancel={() => setBatchConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}

function TemplateCard({
  template: t,
  checkboxVisible,
  deleteVisible,
  selected,
  onToggle,
  onDelete,
}: {
  template: TemplateSummary;
  checkboxVisible: boolean;
  deleteVisible: boolean;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const hasShot = t.latestVersionId !== null && t.screenshotPath !== null;
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-300 hover:shadow">
      <Link
        href={`/templates/${t.id}?projectId=${t.projectId}&topicId=${t.topicId}`}
        className="flex flex-1 flex-col focus:outline-none"
      >
        {/* 竖向预览图 */}
        <div className="relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden bg-slate-100">
          {hasShot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screenshotUrl(t.latestVersionId!, "desktop")}
              alt={t.name}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <span className="text-sm text-slate-400">暂无预览</span>
          )}
        </div>
        <div className="p-3">
          <h3 className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-700">
            {t.name}
          </h3>
        </div>
      </Link>

      {deleteVisible ? (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-2 top-2 z-10 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-rose-600 opacity-0 shadow-sm transition hover:bg-rose-50 focus:opacity-100 group-hover:opacity-100"
        >
          删除
        </button>
      ) : null}

      {checkboxVisible ? (
        <label className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white/90 shadow-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={selected}
            onChange={onToggle}
          />
        </label>
      ) : null}
    </div>
  );
}

function CreateTemplateModal({
  projectId,
  topics,
  defaultTopicId,
  onClose,
}: {
  projectId: number;
  topics: Topic[];
  defaultTopicId: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [topicId, setTopicId] = useState<number>(
    defaultTopicId ?? topics[0]?.id ?? 0,
  );
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [tags, setTags] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!topicId) {
      setError("请选择主题");
      return;
    }
    setBusy(true);
    try {
      const { template } = await api.templates.create(topicId, {
        name,
        purpose: purpose || undefined,
        tags: tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        html: html || undefined,
        note: html ? "初始版本" : undefined,
      });
      router.push(`/templates/${template.id}?projectId=${projectId}&topicId=${topicId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <Modal title="新建模板" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="所属主题">
          <select
            className={inputCls}
            value={topicId}
            onChange={(e) => setTopicId(Number(e.target.value))}
          >
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="模板名称">
          <input
            required
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="用途（可选）">
          <input
            className={inputCls}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </Field>
        <Field label="标签（逗号分隔，可选）">
          <input
            className={inputCls}
            placeholder="促销, 周刊"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
        <Field label="初始 HTML（可选）">
          <textarea
            rows={6}
            className={`${inputCls} font-mono text-xs`}
            placeholder="<html>…</html>"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
          />
        </Field>
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
