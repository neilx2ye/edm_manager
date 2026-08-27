"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import type { Topic } from "@/lib/types";
import {
  ErrorText,
  Field,
  Modal,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui";

/** 新建 / 编辑主题弹窗（topic 为 null 时表示新建）。 */
export function TopicFormModal({
  projectId,
  topic,
  onClose,
  onSaved,
}: {
  projectId: number;
  topic: Topic | null;
  onClose: () => void;
  onSaved: (t: Topic) => void;
}) {
  const [name, setName] = useState(topic?.name ?? "");
  const [purpose, setPurpose] = useState(topic?.purpose ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = { name: name.trim(), purpose: purpose.trim() || undefined };
      const t = topic
        ? await api.topics.update(topic.id, data)
        : await api.topics.create(projectId, data);
      onSaved(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <Modal title={topic ? "编辑主题" : "新建主题"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="主题名称">
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
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
