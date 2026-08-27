"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { diffLines } from "diff";
import { html as htmlBeautify } from "js-beautify";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";
import { api } from "@/lib/client-api";
import type {
  JobKind,
  JobStatus,
  Image,
  LintIssue,
  Project,
  Role,
  TemplateDetail as TemplateDetailT,
  Topic,
  Version,
  WsEvent,
} from "@/lib/types";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useRealtime } from "@/hooks/use-realtime";
import {
  ConfirmDialog,
  ErrorText,
  Field,
  Modal,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui";

const CAN_EDIT: Role[] = ["owner", "admin", "editor"];
const ZOOMS = [50, 75, 100, 125];
const PANEL_WIDTH_KEY = "edm.panelWidth";

/** 编辑器字体与 Ctrl+F 搜索工具栏的放大样式。 */
const editorUIScale = EditorView.theme({
  "&": { fontSize: "14px" },
  ".cm-textfield": { fontSize: "13px", padding: "3px 8px" },
  ".cm-button": { fontSize: "13px", padding: "3px 10px" },
  ".cm-search label": { fontSize: "13px" },
  ".cm-search input, .cm-search button, .cm-search label": {
    margin: "3px 8px 3px 0",
  },
  ".cm-panel.cm-search": { padding: "4px 8px 6px" },
});

/** HTML 自闭合/无结束标签元素：定位源码时只取开始标签。 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface TagRange {
  start: number;
  end: number;
}

interface SelectedElementInfo {
  tag: string;
  selector: string;
  range: TagRange | null;
  editable: "text" | "image" | "link" | null;
  textEditable: boolean;
  src: string | null;
  href: string | null;
}

/** 仅保证宽度非负，不做最小/最大限制。 */
function normalizePanelWidth(w: number): number {
  return Math.max(0, Math.round(w));
}

/** HTML 美化：统一缩进与换行，保留 pre/style/script 等内容原文。 */
function beautifyHtml(src: string): string {
  if (!src.trim()) return src;
  return htmlBeautify(src, {
    indent_size: 2,
    indent_char: " ",
    wrap_line_length: 0,
    preserve_newlines: false,
    max_preserve_newlines: 1,
    extra_liners: [],
    unformatted: ["pre", "textarea", "code", "style", "script"],
    content_unformatted: ["pre", "textarea", "code", "style", "script"],
  });
}

export default function TemplateDetail({ templateId }: { templateId: number }) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateDetailT | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const [zoom, setZoom] = useState(100);
  const [live, setLive] = useState(true);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"code" | "versions">("versions");
  const [panelWidth, setPanelWidth] = useState(432);
  const [resizingPanel, setResizingPanel] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] =
    useState<SelectedElementInfo | null>(null);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [diffOf, setDiffOf] = useState<Version | null>(null);
  const [rollbackOf, setRollbackOf] = useState<Version | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const liveRef = useRef(live);
  liveRef.current = live;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const inspectorCleanupRef = useRef<(() => void) | null>(null);
  const clearInspectorRef = useRef<(() => void) | null>(null);
  const codeTextRef = useRef<string>("");
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  const selectedElementRef = useRef<SelectedElementInfo | null>(null);
  selectedElementRef.current = selectedElement;
  const iframeApiRef = useRef<{ startTextEdit: () => void } | null>(null);

  const canEdit = myRole !== null && CAN_EDIT.includes(myRole);
  const canDelete = myRole === "owner" || myRole === "admin";

  // 恢复上次拖拽后的面板宽度（仅客户端）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
      if (raw !== null) {
        const saved = Number(raw);
        if (Number.isFinite(saved)) setPanelWidth(normalizePanelWidth(saved));
      }
    } catch {
      // 忽略 localStorage 不可用
    }
  }, []);

  const refresh = useCallback(async (): Promise<Version[]> => {
    const [t, vs] = await Promise.all([
      api.templates.get(templateId),
      api.templates.versions(templateId),
    ]);
    setTemplate(t);
    const sorted = [...vs].sort((a, b) => b.id - a.id);
    setVersions(sorted);
    setSelectedId((cur) => {
      if (liveRef.current) return sorted[0]?.id ?? null;
      if (cur !== null && sorted.some((v) => v.id === cur)) return cur;
      return sorted[0]?.id ?? null;
    });
    return sorted;
  }, [templateId]);

  useEffect(() => {
    (async () => {
      try {
        const t = await api.templates.get(templateId);
        // 后端无 GET /api/projects/:id，用列表接口取我的角色
        const [vs, projects] = await Promise.all([
          api.templates.versions(templateId),
          api.projects.list(),
        ]);
        setTemplate(t);
        setMyRole(projects.find((p) => p.id === t.projectId)?.myRole ?? null);
        const sorted = [...vs].sort((a, b) => b.id - a.id);
        setVersions(sorted);
        setSelectedId(sorted[0]?.id ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [templateId]);

  useRealtime(template?.projectId ?? null, (event: WsEvent) => {
    if (event.type === "version" && event.templateId === templateId) {
      void refresh();
      if (!liveRef.current) setHasUpdate(true);
    } else if (event.type === "job") {
      void refresh();
    }
  });

  const selected = versions.find((v) => v.id === selectedId) ?? null;

  const selectedHtml = selected?.html ?? "";
  const formattedHtml = useMemo(
    () => (selectedHtml ? beautifyHtml(selectedHtml) : ""),
    [selectedHtml],
  );
  // null 表示未编辑，显示自动美化后的当前版本代码
  const displayCode = codeDraft ?? formattedHtml;
  const codeDirty = codeDraft !== null;
  codeTextRef.current = displayCode;

  // 代码编辑实时预览：防抖后把编辑内容直接写入预览 iframe（避免每次击键都重建文档）
  useEffect(() => {
    if (codeDraft === null) {
      setPreviewDraft(null);
      return;
    }
    const timer = setTimeout(() => setPreviewDraft(codeDraft), 250);
    return () => clearTimeout(timer);
  }, [codeDraft]);

  useEffect(() => {
    if (previewDraft === null) return;
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(previewDraft);
    doc.close();
    attachInspector();
  }, [previewDraft]);

  const lintIssues = useMemo(() => {
    if (!selected) return [];
    const order = { error: 0, warn: 1, info: 2 } as const;
    return [...selected.lintReport].sort(
      (a, b) => order[a.severity] - order[b.severity],
    );
  }, [selected]);

  /** 在预览 iframe 中注入悬停/点击选中逻辑，并联动右侧代码面板定位。 */
  function attachInspector() {
    inspectorCleanupRef.current?.();
    clearInspectorRef.current = null;

    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    let style = doc.getElementById("__edm_inspector");
    if (!style) {
      style = doc.createElement("style");
      style.id = "__edm_inspector";
      style.textContent = [
        ".__edm-hover{outline:2px dashed rgba(99,102,241,.85)!important;outline-offset:-2px!important}",
        ".__edm-selected{outline:2px solid #4f46e5!important;outline-offset:-2px!important;background-color:rgba(99,102,241,.10)!important}",
        ".__edm-editing{outline:2px solid #0ea5e9!important;outline-offset:-2px!important}",
      ].join("\n");
      (doc.head ?? doc.documentElement).appendChild(style);
    }

    let hoverEl: Element | null = null;
    let selectedEl: Element | null = null;
    let editingEl: Element | null = null;
    let editOriginalText = "";

    const asElement = (target: EventTarget | null): Element | null =>
      target && (target as Node).nodeType === 1 ? (target as Element) : null;

    const onOver = (e: Event) => {
      const el = asElement(e.target);
      if (!el || el === doc.documentElement || el === hoverEl) return;
      if (editingEl && (el === editingEl || editingEl.contains(el))) return;
      hoverEl?.classList.remove("__edm-hover");
      hoverEl = el;
      el.classList.add("__edm-hover");
    };

    const onOut = (e: Event) => {
      const el = asElement(e.target);
      if (el && el === hoverEl) {
        el.classList.remove("__edm-hover");
        hoverEl = null;
      }
    };

    const select = (el: Element) => {
      if (editingEl) return;
      selectedEl?.classList.remove("__edm-selected");
      selectedEl = el;
      el.classList.add("__edm-selected");
      const tag = el.tagName.toLowerCase();
      const range = locateElement(
        codeTextRef.current,
        tag,
        el.id,
        tagIndex(doc, el),
      );
      const textOnly = el.childElementCount === 0;
      const textEditable =
        range !== null &&
        textOnly &&
        isSimpleTextRange(codeTextRef.current, range, tag);
      const editable =
        range === null
          ? null
          : tag === "img"
            ? "image"
            : tag === "a"
              ? "link"
              : !VOID_TAGS.has(tag) && textEditable
                ? "text"
                : null;
      setSelectedElement({
        tag,
        selector: cssPath(el),
        range,
        editable,
        textEditable,
        src: tag === "img" ? (el.getAttribute("src") ?? "") : null,
        href: tag === "a" ? (el.getAttribute("href") ?? "") : null,
      });
      setPanelOpen(true);
      setPanelTab("code");
    };

    const onClick = (e: Event) => {
      const el = asElement(e.target);
      if (!el || el === editingEl) return;
      e.preventDefault();
      e.stopPropagation();
      select(el);
    };

    const startTextEdit = () => {
      if (!selectedEl || selectedEl.childElementCount !== 0) return;
      editingEl = selectedEl;
      editOriginalText = editingEl.textContent ?? "";
      editingEl.setAttribute("contenteditable", "plaintext-only");
      editingEl.classList.add("__edm-editing");
      const range = doc.createRange();
      range.selectNodeContents(editingEl);
      const sel = doc.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      (editingEl as HTMLElement).focus();
    };

    const finishTextEdit = (commit: boolean) => {
      if (!editingEl) return;
      const el = editingEl;
      const text = el.textContent ?? "";
      el.removeAttribute("contenteditable");
      el.classList.remove("__edm-editing");
      editingEl = null;
      if (commit) {
        commitTextEdit(text);
      } else {
        el.textContent = editOriginalText;
      }
    };

    const onKeyDown = (e: Event) => {
      if (!editingEl) return;
      const key = (e as KeyboardEvent).key;
      if (key === "Enter") {
        e.preventDefault();
        finishTextEdit(true);
      } else if (key === "Escape") {
        finishTextEdit(false);
      }
    };

    const onFocusOut = (e: Event) => {
      if (!editingEl) return;
      const related = (e as FocusEvent).relatedTarget;
      if (!related || !editingEl.contains(related as Node)) {
        finishTextEdit(true);
      }
    };

    doc.addEventListener("mouseover", onOver);
    doc.addEventListener("mouseout", onOut);
    doc.addEventListener("click", onClick);
    doc.addEventListener("keydown", onKeyDown);
    doc.addEventListener("focusout", onFocusOut);

    iframeApiRef.current = { startTextEdit };

    inspectorCleanupRef.current = () => {
      doc.removeEventListener("mouseover", onOver);
      doc.removeEventListener("mouseout", onOut);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("focusout", onFocusOut);
    };
    clearInspectorRef.current = () => {
      selectedEl?.classList.remove("__edm-selected");
      hoverEl?.classList.remove("__edm-hover");
      selectedEl = null;
      hoverEl = null;
    };
  }

  // 卸载时清理 iframe 注入的监听器；切换版本（iframe 重建）时清除选中状态。
  useEffect(() => {
    return () => {
      inspectorCleanupRef.current?.();
      clearInspectorRef.current?.();
    };
  }, []);

  useEffect(() => {
    setSelectedElement(null);
    setCodeDraft(null);
    setCodeError(null);
  }, [selected?.id]);

  /** 拖拽分隔条调整右侧面板宽度（预览区相应伸缩）。 */
  function startPanelResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    setResizingPanel(true);
    // 同步禁用 iframe 指针事件，避免拖动越过预览区时丢失事件（不等 React 重渲染）
    if (frameRef.current) frameRef.current.style.pointerEvents = "none";
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // 忽略不支持的场景
    }

    const onMove = (ev: PointerEvent) => {
      setPanelWidth(normalizePanelWidth(startWidth + (startX - ev.clientX)));
    };
    const onEnd = () => {
      setResizingPanel(false);
      if (frameRef.current) frameRef.current.style.pointerEvents = "";
      try {
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
      } catch {
        // 忽略
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", onEnd);
      try {
        window.localStorage.setItem(
          PANEL_WIDTH_KEY,
          String(panelWidthRef.current),
        );
      } catch {
        // 忽略 localStorage 不可用
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", onEnd);
  }

  function formatCode() {
    setCodeDraft(beautifyHtml(displayCode));
    setCodeError(null);
  }

  /** 复制代码面板当前内容（含未提交的编辑）。 */
  async function copyCode() {
    if (!displayCode) return;
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1800);
  }

  async function submitCode() {
    if (!selected || !codeDirty) return;
    setCodeBusy(true);
    setCodeError(null);
    try {
      const v = await api.templates.pushVersion(templateId, {
        html: displayCode,
        source: displayCode,
      });
      await refresh();
      setSelectedId(v.id);
      setCodeDraft(null);
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setCodeBusy(false);
    }
  }

  /** 渲染框内文案编辑提交：写回源码草稿，并修正元素选区范围。 */
  function commitTextEdit(text: string) {
    const sel = selectedElementRef.current;
    if (
      !sel ||
      sel.range === null ||
      (sel.editable !== "text" && sel.editable !== "link")
    ) {
      return;
    }
    const html = codeTextRef.current;
    const next = replaceElementInnerText(html, sel.range, sel.tag, text);
    if (next === html) return;
    setCodeDraft(next);
    setSelectedElement({
      ...sel,
      range: {
        start: sel.range.start,
        end: sel.range.end + (next.length - html.length),
      },
    });
  }

  /** 修改选中元素的属性值：写回源码草稿，并修正元素选区范围。 */
  function applyAttrEdit(attr: string, value: string) {
    const sel = selectedElementRef.current;
    if (
      !sel ||
      sel.range === null ||
      (sel.editable !== "image" && sel.editable !== "link")
    ) {
      return;
    }
    const html = codeTextRef.current;
    const next = replaceAttrInTag(html, sel.range, attr, value);
    if (!next || next === html) return;
    setCodeDraft(next);
    setSelectedElement({
      ...sel,
      range: {
        start: sel.range.start,
        end: sel.range.end + (next.length - html.length),
      },
    });
  }

  async function approve(v: Version) {
    setActionError(null);
    setBusy(true);
    try {
      await api.templates.approve(templateId, v.id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function rollback(v: Version) {
    setActionError(null);
    setBusy(true);
    try {
      const nv = await api.templates.rollback(templateId, v.id);
      await refresh();
      setSelectedId(nv.id);
      setRollbackOf(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate() {
    if (!template) return;
    setActionError(null);
    setDeleteBusy(true);
    try {
      await api.templates.remove(templateId);
      router.push(
        `/templates?projectId=${template.projectId}&topicId=${template.topicId}`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "删除失败");
      setDeleteBusy(false);
      setShowDelete(false);
    }
  }

  if (loading) return <Spinner />;
  if (error || !template) {
    return (
      <div className="p-8">
        <ErrorText message={error ?? "模板不存在"} />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* 顶部工具条 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        {/* 面包屑：项目 / 主题 / 模板 */}
        <nav className="flex min-w-0 items-center gap-1.5 text-sm text-slate-400">
          <Link
            href={`/templates?projectId=${template.projectId}`}
            className="max-w-40 truncate hover:text-indigo-600"
          >
            {template.projectName}
          </Link>
          <span>/</span>
          <Link
            href={`/templates?projectId=${template.projectId}&topicId=${template.topicId}`}
            className="max-w-40 truncate hover:text-indigo-600"
          >
            {template.topicName}
          </Link>
          <span>/</span>
        </nav>
        <RenameableName
          name={template.name}
          canEdit={canEdit}
          onSave={async (name) => {
            try {
              const t = await api.templates.update(templateId, { name });
              setTemplate((prev) => (prev ? { ...prev, name: t.name } : prev));
            } catch (err) {
              setActionError(err instanceof Error ? err.message : "改名失败");
            }
          }}
        />
        {selected ? <StatusBadge status={selected.status} /> : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={!selected}
            onClick={() => void copyCode()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copyState === "copied"
              ? "已复制"
              : copyState === "failed"
                ? "复制失败"
                : "复制代码"}
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setShowMove(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              移动/复制
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              删除模板
            </button>
          ) : null}
          {/* desktop / mobile */}
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {(["desktop", "mobile"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-medium ${
                  mode === m
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {m === "desktop" ? "桌面" : "移动"}
              </button>
            ))}
          </div>
          <select
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {ZOOMS.map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </select>
          {/* 实时模式开关 */}
          <button
            type="button"
            onClick={() => {
              const next = !live;
              setLive(next);
              if (next && versions.length > 0) {
                setSelectedId(versions[0].id);
                setHasUpdate(false);
              }
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              live
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-slate-300"}`}
            />
            实时模式
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            {panelOpen ? "收起面板 ›" : "‹ 展开面板"}
          </button>
        </div>
      </div>

      {actionError ? (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {actionError}
        </div>
      ) : null}

      {hasUpdate && !live ? (
        <button
          type="button"
          onClick={async () => {
            const sorted = await refresh();
            if (sorted[0]) setSelectedId(sorted[0].id);
            setHasUpdate(false);
          }}
          className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-700 hover:bg-amber-100"
        >
          有新版本更新，点击切换到最新版本 →
        </button>
      ) : null}

      {/* lint 问题条 */}
      {lintIssues.length > 0 ? (
        <div className="max-h-28 overflow-y-auto border-b border-slate-200 bg-white px-4 py-2">
          {lintIssues.map((issue, i) => (
            <LintRow key={i} issue={issue} />
          ))}
        </div>
      ) : null}

      {/* 主区域 */}
      <div className="flex min-h-0 flex-1">
        {/* 左：画布 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex-1 overflow-auto bg-slate-100 p-4">
            {selected ? (
              <div
                className="mx-auto h-full"
                style={{
                  width: mode === "mobile" ? 375 : "100%",
                  maxWidth: "100%",
                }}
              >
                <div
                  style={{
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: "top center",
                    height: `${100 / (zoom / 100)}%`,
                  }}
                  className="h-full"
                >
                  <iframe
                    key={selected.id}
                    ref={frameRef}
                    sandbox="allow-same-origin"
                    srcDoc={selected.html}
                    title={`版本 #${selected.id} 预览`}
                    onLoad={attachInspector}
                    className={`h-full w-full rounded-lg border border-slate-200 bg-white shadow-sm ${
                      resizingPanel ? "pointer-events-none" : ""
                    }`}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                该模板还没有版本
              </div>
            )}

            {/* 渲染框内直接编辑：文字 / 图片 */}
            {selectedElement?.editable ? (
              <div className="absolute right-3 top-3 z-10">
                {selectedElement.editable === "text" ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md">
                    <span className="text-xs text-slate-500">
                      编辑 &lt;{selectedElement.tag}&gt; 文案
                    </span>
                    <button
                      type="button"
                      onClick={() => iframeApiRef.current?.startTextEdit()}
                      className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      编辑文案
                    </button>
                  </div>
                ) : selectedElement.editable === "image" ? (
                  <ImageSwapBar
                    projectId={template.projectId}
                    canEdit={canEdit}
                    currentSrc={selectedElement.src ?? ""}
                    onApply={(url) => applyAttrEdit("src", url)}
                  />
                ) : (
                  <LinkEditBar
                    currentHref={selectedElement.href ?? ""}
                    textEditable={selectedElement.textEditable}
                    onApplyHref={(url) => applyAttrEdit("href", url)}
                    onEditText={() => iframeApiRef.current?.startTextEdit()}
                  />
                )}
              </div>
            ) : null}
          </div>

          {/* HTML 编辑器 */}
          {canEdit ? (
            <div className="border-t border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setEditorOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <span>编辑 HTML 并提交新版本</span>
                <span className="text-slate-400">{editorOpen ? "▲" : "▼"}</span>
              </button>
              {editorOpen ? (
                <VersionEditor
                  templateId={templateId}
                  baseHtml={selected?.html ?? ""}
                  onSubmitted={(v) => {
                    void refresh();
                    setSelectedId(v.id);
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 可拖拽分隔条：调整渲染区与右侧面板宽度 */}
        {panelOpen ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整面板宽度"
            onPointerDown={startPanelResize}
            className={`relative w-1.5 shrink-0 touch-none cursor-col-resize ${
              resizingPanel ? "bg-indigo-100" : "hover:bg-indigo-50"
            }`}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-200" />
          </div>
        ) : null}

        {/* 右：代码定位 / 版本时间线 */}
        {panelOpen ? (
          <aside
            style={{ width: panelWidth }}
            className="flex shrink-0 flex-col bg-white"
          >
            <div className="flex shrink-0 border-b border-slate-200">
              {(["code", "versions"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setPanelTab(tab)}
                  className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium ${
                    panelTab === tab
                      ? "border-indigo-500 text-indigo-600"
                      : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  }`}
                >
                  {tab === "code" ? "代码" : "版本"}
                </button>
              ))}
            </div>
            {panelTab === "code" ? (
              <CodePanel
                value={displayCode}
                onChange={setCodeDraft}
                onFormat={formatCode}
                onSubmit={() => void submitCode()}
                busy={codeBusy}
                error={codeError}
                dirty={codeDirty}
                range={selectedElement?.range ?? null}
                element={
                  selectedElement
                    ? {
                        tag: selectedElement.tag,
                        selector: selectedElement.selector,
                      }
                    : null
                }
                onClear={() => {
                  clearInspectorRef.current?.();
                  setSelectedElement(null);
                }}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800">
                  版本时间线
                </div>
                <div className="flex-1 overflow-y-auto">
                  {versions.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">暂无版本</p>
                  ) : (
                    versions.map((v) => (
                      <VersionItem
                        key={v.id}
                        version={v}
                        selected={v.id === selectedId}
                        canEdit={canEdit}
                        busy={busy}
                        onSelect={() => setSelectedId(v.id)}
                        onApprove={() => void approve(v)}
                        onRollback={() => setRollbackOf(v)}
                        onDiff={() => setDiffOf(v)}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </aside>
        ) : null}
      </div>

      {rollbackOf ? (
        <ConfirmDialog
          title={`回滚到版本 #${rollbackOf.id}`}
          message="将以该版本的 HTML 复制生成一个新版本，当前内容不会被删除。确认回滚？"
          confirmLabel="回滚"
          busy={busy}
          onConfirm={() => void rollback(rollbackOf)}
          onCancel={() => setRollbackOf(null)}
        />
      ) : null}

      {diffOf && selected ? (
        <DiffModal base={diffOf} current={selected} onClose={() => setDiffOf(null)} />
      ) : null}

      {showMove ? (
        <MoveTemplateModal
          template={template}
          onClose={() => setShowMove(false)}
          onMoved={() => {
            setShowMove(false);
            void refresh();
          }}
          onCopied={(newId, pid, tid) =>
            router.push(`/templates/${newId}?projectId=${pid}&topicId=${tid}`)
          }
        />
      ) : null}

      {showDelete ? (
        <ConfirmDialog
          title="删除模板"
          message={`确认删除模板「${template.name}」吗？其所有版本与截图都会被永久删除，且无法恢复。`}
          confirmLabel="删除"
          busy={deleteBusy}
          onConfirm={() => void removeTemplate()}
          onCancel={() => setShowDelete(false)}
        />
      ) : null}

    </div>
  );
}

/* ---------- 子组件 ---------- */

function RenameableName({
  name,
  canEdit,
  onSave,
}: {
  name: string;
  canEdit: boolean;
  onSave: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  if (!editing) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setEditing(true)}
        title={canEdit ? "点击改名" : undefined}
        className="max-w-72 truncate text-base font-semibold text-slate-900 enabled:hover:text-indigo-700"
      >
        {name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      className={`${inputCls} max-w-72 py-1`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const next = value.trim();
        if (next && next !== name) void onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setValue(name);
          setEditing(false);
        }
      }}
    />
  );
}

const severityStyle: Record<LintIssue["severity"], string> = {
  error: "bg-rose-100 text-rose-700",
  warn: "bg-amber-100 text-amber-700",
  info: "bg-slate-100 text-slate-600",
};

function LintRow({ issue }: { issue: LintIssue }) {
  return (
    <div className="flex items-start gap-2 py-0.5 text-xs">
      <span
        className={`mt-px shrink-0 rounded px-1.5 py-0.5 font-medium ${severityStyle[issue.severity]}`}
      >
        {issue.severity}
      </span>
      <span className="text-slate-700">
        <span className="font-mono text-slate-400">[{issue.rule}]</span>{" "}
        {issue.message}
        {issue.detail ? (
          <span className="text-slate-400">（{issue.detail}）</span>
        ) : null}
      </span>
    </div>
  );
}

const jobIcon: Record<JobStatus, { text: string; cls: string; label: string }> = {
  pending: { text: "◷", cls: "text-slate-400", label: "排队中" },
  running: { text: "◔", cls: "text-sky-500", label: "运行中" },
  done: { text: "✓", cls: "text-emerald-600", label: "完成" },
  failed: { text: "✗", cls: "text-rose-600", label: "失败" },
};

function JobIcons({ version }: { version: Version }) {
  const byKind = new Map<JobKind, JobStatus>();
  for (const j of version.jobs) byKind.set(j.kind, j.status);
  return (
    <span className="flex gap-1.5 text-xs">
      {(["lint", "screenshot"] as const).map((kind) => {
        const status = byKind.get(kind);
        if (!status) return null;
        const icon = jobIcon[status];
        return (
          <span
            key={kind}
            title={`${kind === "lint" ? "lint" : "截图"}任务：${icon.label}`}
            className={icon.cls}
          >
            {kind === "lint" ? "lint" : "截图"} {icon.text}
          </span>
        );
      })}
    </span>
  );
}

function VersionItem({
  version: v,
  selected,
  canEdit,
  busy,
  onSelect,
  onApprove,
  onRollback,
  onDiff,
}: {
  version: Version;
  selected: boolean;
  canEdit: boolean;
  busy: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onRollback: () => void;
  onDiff: () => void;
}) {
  return (
    <div
      className={`cursor-pointer border-b border-slate-100 px-4 py-3 ${
        selected ? "bg-indigo-50/60 ring-1 ring-inset ring-indigo-200" : "hover:bg-slate-50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={v.status} />
        <span className="font-mono text-xs text-slate-500">#{v.id}</span>
        <span className="ml-auto">
          <JobIcons version={v} />
        </span>
      </div>
      {v.note ? (
        <p className="mt-1 line-clamp-2 text-sm text-slate-700">{v.note}</p>
      ) : null}
      <p className="mt-1 text-xs text-slate-400">
        <span title={formatDateTime(v.createdAt)}>{formatRelative(v.createdAt)}</span>
        {v.createdBy ? ` · ${v.createdBy}` : ""}
      </p>
      <div
        className="mt-2 flex gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {canEdit && v.status === "draft" ? (
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            采纳为 saved
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRollback}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            回滚
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDiff}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          对比 diff
        </button>
      </div>
    </div>
  );
}

function VersionEditor({
  templateId,
  baseHtml,
  onSubmitted,
}: {
  templateId: number;
  baseHtml: string;
  onSubmitted: (v: Version) => void;
}) {
  const [html, setHtml] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const v = await api.templates.pushVersion(templateId, {
        html,
        note: note || undefined,
        source: "web-editor",
      });
      setHtml("");
      setNote("");
      onSubmitted(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 px-4 pb-3">
      <textarea
        required
        rows={8}
        className={`${inputCls} font-mono text-xs`}
        placeholder="粘贴或编辑 HTML 源码…"
        value={html}
        onChange={(e) => setHtml(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <input
          className={`${inputCls} flex-1`}
          placeholder="提交说明（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          className={btnSecondary}
          onClick={() => setHtml(baseHtml)}
        >
          填入当前版本
        </button>
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "提交中…" : "提交新版本"}
        </button>
      </div>
      <ErrorText message={error} />
    </form>
  );
}

/* ---------- 右侧代码定位 ---------- */

function CodePanel({
  value,
  onChange,
  onFormat,
  onSubmit,
  busy,
  error,
  dirty,
  range,
  element,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  onFormat: () => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  dirty: boolean;
  range: TagRange | null;
  element: { tag: string; selector: string } | null;
  onClear: () => void;
}) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  // 选中 DOM 节点后：在编辑器中选中并滚动到对应源码区间
  useEffect(() => {
    const view = cmRef.current?.view;
    if (!view || range === null) return;
    const length = view.state.doc.length;
    view.dispatch({
      selection: {
        anchor: Math.min(Math.max(0, range.start), length),
        head: Math.min(Math.max(0, range.end), length),
      },
      scrollIntoView: true,
    });
    view.focus();
  }, [range]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2">
        {element ? (
          <div className="min-w-0">
            <span className="font-mono text-xs font-semibold text-indigo-600">
              &lt;{element.tag}&gt;
            </span>
            <p
              title={element.selector}
              className="mt-0.5 truncate font-mono text-[11px] text-slate-400"
            >
              {element.selector}
            </p>
            {range === null ? (
              <p className="mt-0.5 text-[11px] text-amber-600">
                未在源码中定位到该节点（可能是浏览器生成的容器）
              </p>
            ) : null}
          </div>
        ) : (
          <p className="py-1 text-xs text-slate-400">
            点击左侧预览中的元素，定位到对应代码
          </p>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {element ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              清除选中
            </button>
          ) : null}
          <button
            type="button"
            onClick={onFormat}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            格式化
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !dirty}
            className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "提交中…" : "提交新版本"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-white">
        <CodeMirror
          ref={cmRef}
          value={value}
          height="100%"
          theme="light"
          extensions={[html(), editorUIScale]}
          basicSetup={{
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            autocompletion: false,
          }}
          onChange={onChange}
          placeholder="<!-- 模板 HTML -->"
          className="h-full text-left"
        />
      </div>

      {error ? (
        <div className="shrink-0 border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-xs text-rose-600">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- DOM 节点 → 源码位置映射 ---------- */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 元素在文档中同标签元素里的 DOM 顺序（用于映射回源码标签出现顺序）。 */
function tagIndex(doc: Document, el: Element): number {
  const tag = el.tagName.toLowerCase();
  const all = doc.querySelectorAll(tag);
  for (let i = 0; i < all.length; i++) {
    if (all[i] === el) return i;
  }
  return -1;
}

/** 生成简短的 CSS 选择器路径（含 id 时提前终止）。 */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 5) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`${tag}#${cur.id}`);
      return parts.join(" > ");
    }
    parts.unshift(tag);
    cur = cur.parentElement;
    depth += 1;
  }
  return parts.join(" > ");
}

/**
 * 在原始 HTML 中定位元素的开始/结束标签区间。
 * 优先按 id 精确匹配，否则按同标签出现顺序匹配；容错处理浏览器自动生成的容器。
 */
function locateElement(
  html: string,
  tag: string,
  id: string,
  domIndex: number,
): TagRange | null {
  const lower = html.toLowerCase();
  const openTag = `<${tag}`;
  const closeTag = `</${tag}`;
  let start = -1;
  let seen = 0;
  let i = 0;

  while (i < lower.length) {
    const oi = lower.indexOf(openTag, i);
    if (oi === -1) break;
    const after = lower[oi + openTag.length];
    if (after !== undefined && !/[\s/>]/.test(after)) {
      i = oi + openTag.length;
      continue;
    }
    const gt = findTagEnd(html, oi);
    const tagText = gt === -1 ? html.slice(oi) : html.slice(oi, gt + 1);
    const isTarget = id
      ? new RegExp(`\\b[iI][dD]\\s*=\\s*["']${escapeRegExp(id)}["']`).test(
          tagText,
        )
      : seen === domIndex;
    if (isTarget) {
      start = oi;
      break;
    }
    seen += 1;
    i = gt === -1 ? oi + openTag.length : gt + 1;
  }

  if (start < 0) return null;

  if (VOID_TAGS.has(tag)) {
    const gt = findTagEnd(html, start);
    return { start, end: gt === -1 ? start + 1 : gt + 1 };
  }

  let depth = 1;
  let pos = findTagEnd(html, start);
  pos = pos === -1 ? start + 1 : pos + 1;
  while (pos < lower.length && depth > 0) {
    const oi = lower.indexOf(openTag, pos);
    const ci = lower.indexOf(closeTag, pos);
    // 找不到匹配的闭合标签（HTML 允许省略 </p>、</li> 等）：不再臆测范围，
    // 返回 null 避免编辑时把后续内容一并替换。
    if (ci === -1) return null;
    if (oi !== -1 && oi < ci) {
      const after = lower[oi + openTag.length];
      if (/[\s/>]/.test(after)) depth += 1;
      pos = oi + openTag.length;
    } else {
      const afterClose = lower[ci + closeTag.length];
      if (afterClose === undefined || /[\s/>]/.test(afterClose)) {
        depth -= 1;
        if (depth === 0) {
          const gt = html.indexOf(">", ci);
          return { start, end: gt === -1 ? ci + closeTag.length : gt + 1 };
        }
      }
      pos = ci + closeTag.length;
    }
  }
  return null;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 找到开标签真正的结束 `>`（跳过引号内属性值中的 `>`）。 */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

/** 替换「无子元素」标签的内部文本（用于渲染框内直接改文案）。 */
function replaceElementInnerText(
  html: string,
  range: TagRange,
  tag: string,
  text: string,
): string {
  const openEnd = findTagEnd(html, range.start);
  if (openEnd === -1) return html;
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  closeRe.lastIndex = openEnd + 1;
  const m = closeRe.exec(html);
  if (!m || m.index >= range.end) return html;
  // 防护：开标签与闭合标签之间若还有其他标签，说明闭合标签不属于该元素
  //（源码省略了本元素的闭合标签），拒绝整段替换以免吞掉样式与后续内容。
  const between = html.slice(openEnd + 1, m.index);
  if (/<[a-zA-Z!/]/.test(between)) return html;
  return (
    html.slice(0, openEnd + 1) + escapeHtmlText(text) + html.slice(m.index)
  );
}

/** 判断元素源码区间内是否只有文本（可安全原地替换文案）。 */
function isSimpleTextRange(html: string, range: TagRange, tag: string): boolean {
  const openEnd = findTagEnd(html, range.start);
  if (openEnd === -1) return false;
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  closeRe.lastIndex = openEnd + 1;
  const m = closeRe.exec(html);
  if (!m || m.index >= range.end) return false;
  return !/<[a-zA-Z!/]/.test(html.slice(openEnd + 1, m.index));
}

/** 替换标签内属性值；属性不存在时插到标签名后（用于切换图片 src）。 */
function replaceAttrInTag(
  html: string,
  range: TagRange,
  attr: string,
  value: string,
): string | null {
  const tagText = html.slice(range.start, range.end);
  const re = new RegExp(`\\b${attr}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  const m = re.exec(tagText);
  if (m) {
    const replacement = `${attr}="${escapeHtmlAttr(value)}"`;
    return (
      html.slice(0, range.start + m.index) +
      replacement +
      html.slice(range.start + m.index + m[0].length)
    );
  }
  const nameMatch = /^<[a-zA-Z][a-zA-Z0-9:-]*/.exec(tagText);
  if (nameMatch) {
    const pos = range.start + nameMatch[0].length;
    return (
      html.slice(0, pos) +
      ` ${attr}="${escapeHtmlAttr(value)}"` +
      html.slice(pos)
    );
  }
  return null;
}

/* ---------- 渲染框内切换图片 ---------- */

function ImageSwapBar({
  projectId,
  canEdit,
  currentSrc,
  onApply,
}: {
  projectId: number;
  canEdit: boolean;
  currentSrc: string;
  onApply: (url: string) => void;
}) {
  const [url, setUrl] = useState(currentSrc);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [images, setImages] = useState<Image[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setUrl(currentSrc), [currentSrc]);

  function togglePicker() {
    const next = !pickerOpen;
    setPickerOpen(next);
    if (next && images === null) {
      setError(null);
      api.images
        .list(projectId)
        .then(setImages)
        .catch((err) =>
          setError(err instanceof Error ? err.message : "加载图库失败"),
        );
    }
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const img = await api.images.upload(projectId, file);
      setImages((prev) => (prev ? [img, ...prev] : [img]));
      setUrl(img.url);
      onApply(img.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  function apply() {
    const next = url.trim();
    if (!next) return;
    onApply(next);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md">
        <span className="text-xs text-slate-500">图片 src</span>
        <input
          className="w-52 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
        <button
          type="button"
          onClick={apply}
          disabled={!url.trim()}
          className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          应用
        </button>
        <button
          type="button"
          onClick={togglePicker}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          图库
        </button>
        {canEdit ? (
          <>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploading ? "上传中…" : "上传"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onUpload(e)}
            />
          </>
        ) : null}
      </div>
      {pickerOpen ? (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-72 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {error ? (
            <p className="p-2 text-xs text-rose-600">{error}</p>
          ) : null}
          {images === null ? (
            <p className="p-2 text-xs text-slate-400">加载中…</p>
          ) : images.length === 0 ? (
            <p className="p-2 text-xs text-slate-400">图库为空</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  title={img.name}
                  onClick={() => {
                    setUrl(img.url);
                    onApply(img.url);
                    setPickerOpen(false);
                  }}
                  className="group overflow-hidden rounded border border-slate-200 text-left hover:border-indigo-400"
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="h-14 w-full object-cover"
                  />
                  <span className="block truncate px-1 py-0.5 text-[10px] text-slate-500">
                    {img.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 渲染框内修改超链接 ---------- */

function LinkEditBar({
  currentHref,
  textEditable,
  onApplyHref,
  onEditText,
}: {
  currentHref: string;
  textEditable: boolean;
  onApplyHref: (url: string) => void;
  onEditText: () => void;
}) {
  const [href, setHref] = useState(currentHref);
  useEffect(() => setHref(currentHref), [currentHref]);

  function apply() {
    const next = href.trim();
    if (!next) return;
    onApplyHref(next);
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md">
      <span className="text-xs text-slate-500">链接 href</span>
      <input
        className="w-52 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500"
        placeholder="https://… 或 mailto:…"
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
      />
      <button
        type="button"
        onClick={apply}
        disabled={!href.trim()}
        className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        应用
      </button>
      {textEditable ? (
        <button
          type="button"
          onClick={onEditText}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          编辑文案
        </button>
      ) : null}
    </div>
  );
}

/* ---------- 移动/复制到目标主题 ---------- */

function MoveTemplateModal({
  template,
  onClose,
  onMoved,
  onCopied,
}: {
  template: TemplateDetailT;
  onClose: () => void;
  onMoved: () => void;
  onCopied: (newTemplateId: number, projectId: number, topicId: number) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState(template.projectId);
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [topicId, setTopicId] = useState<number | null>(null);
  const [copy, setCopy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.projects
      .list()
      .then(setProjects)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载项目失败"),
      );
  }, []);

  useEffect(() => {
    setTopics(null);
    setTopicId(null);
    api.topics
      .list(projectId)
      .then((ts) => {
        setTopics(ts);
        setTopicId(ts[0]?.id ?? null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载主题失败"),
      );
  }, [projectId]);

  // 移动（非复制）到原主题没有意义，从候选中排除
  const selectableTopics = (topics ?? []).filter(
    (t) => copy || t.id !== template.topicId || projectId !== template.projectId,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!topicId) {
      setError("请选择目标主题");
      return;
    }
    if (!copy && topicId === template.topicId && projectId === template.projectId) {
      setError("目标主题与当前主题相同");
      return;
    }
    setBusy(true);
    try {
      const res = await api.templates.move(template.id, topicId, copy);
      if (copy) {
        onCopied(res.templateId, projectId, topicId);
      } else {
        onMoved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      setBusy(false);
    }
  }

  return (
    <Modal title={`移动/复制「${template.name}」`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="目标项目">
          <select
            className={inputCls}
            value={projectId}
            onChange={(e) => setProjectId(Number(e.target.value))}
            disabled={!projects}
          >
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="目标主题">
          <select
            className={inputCls}
            value={topicId ?? ""}
            onChange={(e) => setTopicId(Number(e.target.value))}
            disabled={!topics || selectableTopics.length === 0}
          >
            {selectableTopics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {topics && selectableTopics.length === 0 ? (
            <span className="mt-1 block text-xs text-amber-600">
              该项目下没有可用的目标主题，请先创建主题
            </span>
          ) : null}
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={copy}
            onChange={(e) => setCopy(e.target.checked)}
          />
          复制为新模板（保留原模板）
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !topicId}
            className={btnPrimary}
          >
            {busy ? "处理中…" : copy ? "复制" : "移动"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface DiffRow {
  left: string | null;
  right: string | null;
}

function buildDiffRows(oldHtml: string, newHtml: string): DiffRow[] {
  const norm = (s: string) => s.replace(/></g, ">\n<");
  const parts = diffLines(norm(oldHtml), norm(newHtml));
  const rows: DiffRow[] = [];
  let pendingRemoved: string[] = [];
  const flushRemoved = () => {
    for (const line of pendingRemoved) rows.push({ left: line, right: null });
    pendingRemoved = [];
  };
  for (const part of parts) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (part.removed) {
      pendingRemoved.push(...lines);
    } else if (part.added) {
      const n = Math.max(pendingRemoved.length, lines.length);
      for (let i = 0; i < n; i++) {
        rows.push({
          left: pendingRemoved[i] ?? null,
          right: lines[i] ?? null,
        });
      }
      pendingRemoved = [];
    } else {
      flushRemoved();
      for (const line of lines) rows.push({ left: line, right: line });
    }
  }
  flushRemoved();
  return rows;
}

function DiffModal({
  base,
  current,
  onClose,
}: {
  base: Version;
  current: Version;
  onClose: () => void;
}) {
  const rows = useMemo(
    () => buildDiffRows(base.html, current.html),
    [base, current],
  );
  return (
    <Modal
      title={`版本对比：#${base.id} → #${current.id}`}
      onClose={onClose}
      width="max-w-6xl"
    >
      <div className="mb-2 grid grid-cols-2 gap-2 text-xs font-medium text-slate-500">
        <span>#{base.id}（{formatDateTime(base.createdAt)}）</span>
        <span>#{current.id}（{formatDateTime(current.createdAt)}）</span>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 font-mono text-xs">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2">
            <pre
              className={`whitespace-pre-wrap break-all border-r border-slate-100 px-2 py-0.5 ${
                row.right === null
                  ? "bg-rose-50 text-rose-700"
                  : "text-slate-600"
              }`}
            >
              {row.left ?? ""}
            </pre>
            <pre
              className={`whitespace-pre-wrap break-all px-2 py-0.5 ${
                row.left === null
                  ? "bg-emerald-50 text-emerald-700"
                  : row.left !== row.right
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-600"
              }`}
            >
              {row.right ?? ""}
            </pre>
          </div>
        ))}
      </div>
    </Modal>
  );
}
