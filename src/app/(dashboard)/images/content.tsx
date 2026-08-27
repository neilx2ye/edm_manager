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
import type { Image, Project } from "@/lib/types";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Modal,
  RoleBadge,
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

  if (!projectId) {
    return (
      <div className="p-8">
        <EmptyState title="未选择项目" hint="请从左上角选择项目" />
      </div>
    );
  }
  if (loading) return <Spinner />;

  const canUpload =
    project?.myRole === "owner" ||
    project?.myRole === "admin" ||
    project?.myRole === "editor";
  const canDelete = project?.myRole === "owner" || project?.myRole === "admin";

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

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {project?.name ?? "图片库"}
          </h1>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
            <span>AI agent 可通过 API 上传，图片 URL 可直接用于邮件模板</span>
            {project ? <RoleBadge role={project.myRole} /> : null}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
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
            title={canUpload ? undefined : "需要 editor 及以上角色"}
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
          hint="上传图片后，agent 可把返回的 URL 放进邮件 HTML"
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
                <p className="truncate text-sm font-medium text-slate-800" title={img.name}>
                  {img.name}
                </p>
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
            setImages((prev) => [img, ...prev]);
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

  function selectFile(f: File | null) {
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
  }

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
              <span>点击选择或拖拽图片到此处</span>
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
