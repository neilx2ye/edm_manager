"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client-api";
import { imageFileFromClipboard } from "@/lib/clipboard";
import type { Image, Project } from "@/lib/types";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Modal,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui";

export default function ImagesContent() {
  const searchParams = useSearchParams();
  const projectId = Number(searchParams.get("projectId")) || null;

  const [project, setProject] = useState<Project | null>(null);
  const [images, setImages] = useState<Image[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState<Image | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [projects, list] = await Promise.all([
        api.projects.list(),
        api.images.list(projectId),
      ]);
      setProject(projects.find((p) => p.id === projectId) ?? null);
      setImages(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canUpload = Boolean(project);
  const canDelete = Boolean(project);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }

  // 卸载时清理提示定时器
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const uploadPasted = useCallback(
    async (file: File) => {
      if (!projectId) return;
      setError(null);
      setPasteBusy(true);
      try {
        const img = await api.images.upload(projectId, file);
        if (img.deduplicated) {
          showToast(`图片已存在，复用「${img.name}」`);
        } else {
          setImages((prev) => [img, ...prev]);
          showToast(`已上传「${img.name}」`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "粘贴上传失败");
      } finally {
        setPasteBusy(false);
      }
    },
    [projectId],
  );

  // 页面级粘贴：剪贴板里有图片就上传到图库（弹窗打开时由弹窗自己处理）
  useEffect(() => {
    if (!projectId || !canUpload || showUpload) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFileFromClipboard(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void uploadPasted(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [projectId, canUpload, showUpload, uploadPasted]);

  if (!projectId) {
    return (
      <div className="p-8">
        <EmptyState title="未选择项目" hint="请从左上角选择项目" />
      </div>
    );
  }
  if (loading) return <Spinner />;

  async function copyUrl(img: Image) {
    const absolute = `${window.location.origin}${img.url}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopiedId(img.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // 剪贴板不可用（如非 https）时降级为选中文本提示
      window.prompt("复制图片 URL", absolute);
    }
  }

  function startRename(img: Image) {
    setRenamingId(img.id);
    setRenameValue(img.name);
    setRenameError(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
    setRenameError(null);
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    const next = renameValue.trim();
    if (!renamingId || !next) {
      setRenameError("名称不能为空");
      return;
    }
    const original = images.find((i) => i.id === renamingId)?.name;
    if (!original || next === original) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await api.images.rename(renamingId, next);
      setImages((prev) =>
        prev.map((i) => (i.id === renamingId ? { ...i, name: next } : i)),
      );
      showToast(`已重命名为「${next}」`);
      cancelRename();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {project?.name ?? "图片库"}
          </h1>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
            <span>
              AI agent 可通过 API 上传；也支持 Ctrl+V / ⌘V 粘贴剪贴板图片，相同内容自动复用
            </span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {pasteBusy ? (
            <span className="text-xs text-indigo-500">正在上传粘贴的图片…</span>
          ) : null}
          {project ? (
            <Link
              href={`/projects/${project.id}/settings`}
              className="text-xs text-indigo-600 hover:underline"
            >
              项目设置 →
            </Link>
          ) : null}
          <button
            type="button"
            className={btnPrimary}
            disabled={!canUpload}
            title={canUpload ? undefined : "需要项目成员角色"}
            onClick={() => setShowUpload(true)}
          >
            + 上传图片
          </button>
        </div>
      </div>

      <ErrorText message={error} />

      {images.length === 0 ? (
        <EmptyState
          title="还没有图片"
          hint="上传图片后，agent 可把返回的 URL 放进邮件 HTML；也可直接 Ctrl+V 粘贴图片"
        >
          <button
            type="button"
            className={`${btnPrimary} mt-2`}
            disabled={!canUpload}
            onClick={() => setShowUpload(true)}
          >
            上传第一张图片
          </button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {images.map((img) => (
            <div
              key={img.id}
              className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <a
                href={img.url}
                target="_blank"
                rel="noreferrer"
                className="block aspect-square bg-slate-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </a>
              <div className="space-y-1 p-3">
                {renamingId === img.id ? (
                  <form onSubmit={(e) => void submitRename(e)} className="space-y-1">
                    <input
                      autoFocus
                      value={renameValue}
                      disabled={renameBusy}
                      maxLength={200}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") cancelRename();
                      }}
                      className="w-full rounded border border-indigo-300 px-1.5 py-0.5 text-sm text-slate-800 outline-none focus:border-indigo-500"
                    />
                    {renameError ? (
                      <p className="text-xs text-rose-600">{renameError}</p>
                    ) : null}
                    <div className="flex gap-1">
                      <button
                        type="submit"
                        disabled={renameBusy}
                        className="flex-1 rounded border border-indigo-300 px-2 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                      >
                        {renameBusy ? "保存中…" : "保存"}
                      </button>
                      <button
                        type="button"
                        disabled={renameBusy}
                        onClick={cancelRename}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        取消
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center gap-1">
                    <p
                      className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800"
                      title={img.name}
                    >
                      {img.name}
                    </p>
                    {canUpload ? (
                      <button
                        type="button"
                        title="重命名"
                        aria-label="重命名"
                        onClick={() => startRename(img)}
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        ✏️
                      </button>
                    ) : null}
                  </div>
                )}
                <p className="text-xs text-slate-400">
                  {formatBytes(img.sizeBytes)} · {formatDateTime(img.createdAt)}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {img.sourceApiKeyId
                    ? "上传自 AI agent"
                    : img.createdByEmail || img.createdByName || "上传自用户"}
                </p>
                <div className="flex gap-1 pt-1">
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    onClick={() => void copyUrl(img)}
                  >
                    {copiedId === img.id ? "已复制 ✓" : "复制 URL"}
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      className="rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                      onClick={() => setDeleting(img)}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && projectId ? (
        <UploadModal
          projectId={projectId}
          onClose={() => setShowUpload(false)}
          onUploaded={(img) => {
            setShowUpload(false);
            if (img.deduplicated) {
              showToast(`图片已存在，复用「${img.name}」`);
            } else {
              setImages((prev) => [img, ...prev]);
            }
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="删除图片"
          message={`确定删除「${deleting.name}」吗？模板中引用它的 <img> 会随之失效。`}
          busy={false}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void (async () => {
              try {
                await api.images.remove(deleting.id);
                setImages((prev) => prev.filter((i) => i.id !== deleting.id));
              } catch (err) {
                setError(err instanceof Error ? err.message : "删除失败");
              } finally {
                setDeleting(null);
              }
            })();
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function UploadModal({
  projectId,
  onClose,
  onUploaded,
}: {
  projectId: number;
  onClose: () => void;
  onUploaded: (img: Image) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = useCallback((f: File | null) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) {
      setError("仅支持 PNG / JPEG / WebP / GIF");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("图片不能超过 10 MB");
      return;
    }
    setError(null);
    setFile(f);
    setName((prev) => prev || f.name.replace(/\.[^.]+$/, ""));
    setPreview(URL.createObjectURL(f));
  }, []);

  // 弹窗内支持直接 Ctrl+V 粘贴图片
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFileFromClipboard(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      selectFile(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [selectFile]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("请选择图片文件");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const img = await api.images.upload(projectId, file, name.trim() || undefined);
      onUploaded(img);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
      setBusy(false);
    }
  }

  return (
    <Modal title="上传图片" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            selectFile(e.dataTransfer.files[0] ?? null);
          }}
          className={`flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm ${
            dragging
              ? "border-indigo-500 bg-indigo-50 text-indigo-600"
              : "border-slate-300 bg-slate-50 text-slate-500 hover:border-indigo-400"
          }`}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="预览" className="max-h-32 max-w-full rounded-lg object-contain" />
          ) : (
            <>
              <span className="text-2xl">🖼️</span>
              <span>点击选择、拖拽或 Ctrl+V 粘贴图片到此处</span>
              <span className="text-xs text-slate-400">
                PNG / JPEG / WebP / GIF，最大 10 MB
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
        />
        <Field label="名称（可选，默认取文件名）">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
        </Field>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy || !file} className={btnPrimary}>
            {busy ? "上传中…" : "上传"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
