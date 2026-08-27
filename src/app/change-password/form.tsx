"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { api } from "@/lib/client-api";
import { ErrorText, Field, btnPrimary, inputCls } from "@/components/ui";

export default function ChangePasswordForm() {
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("新密码长度至少 8 位");
      return;
    }
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      await signOut({ redirect: false });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-indigo-600">EDM</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          修改登录密码（首次登录或受邀后建议立即修改）
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="原密码">
            <input
              type="password"
              required
              autoComplete="current-password"
              className={inputCls}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </Field>
          <Field label="新密码">
            <input
              type="password"
              required
              autoComplete="new-password"
              className={inputCls}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="确认新密码">
            <input
              type="password"
              required
              autoComplete="new-password"
              className={inputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <ErrorText message={error} />
          <button
            type="submit"
            disabled={busy}
            className={`${btnPrimary} w-full`}
          >
            {busy ? "提交中…" : "修改密码"}
          </button>
        </form>
      </div>
    </div>
  );
}
