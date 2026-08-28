"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/client-api";
import type { Role, UserAccount, UserMembership } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import {
  ConfirmDialog,
  ErrorText,
  Field,
  Modal,
  RoleBadge,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  selectCls,
} from "@/components/ui";

const ROLE_LABELS: Record<Role, string> = {
  admin: "管理员",
  member: "成员",
};

export default function UsersContent() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      // api.users.* 对非系统管理员返回 403；能列出用户才有权管理
      const [list, projs] = await Promise.all([
        api.users.list(),
        api.users.projects(),
      ]);
      setUsers(list);
      setProjects(projs);
      setForbidden(null);
    } catch (err) {
      setForbidden(err instanceof Error ? err.message : "无权限");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner />;

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-slate-700">无权限</p>
          <p className="text-sm text-slate-400">
            仅系统管理员可管理用户（{forbidden}）
          </p>
          <Link
            href="/change-password"
            className="mt-2 text-sm text-indigo-600 hover:underline"
          >
            修改我的密码 →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">用户管理</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            系统账号与项目分配（管理员 / 成员只有“能否管理用户”的区别）
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/change-password" className={btnSecondary}>
            修改我的密码
          </Link>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setShowCreate(true)}
          >
            + 邀请用户
          </button>
        </div>
      </div>

      <ErrorText message={error} />

      <div className="mt-4 space-y-3">
        {users.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-400">
            暂无用户
          </p>
        ) : (
          users.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              projects={projects}
              onChanged={load}
              onError={setError}
            />
          ))
        )}
      </div>

      {showCreate ? (
        <CreateUserModal
          projects={projects}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- 单个用户卡片 ---------- */

function UserCard({
  user,
  projects,
  onChanged,
  onError,
}: {
  user: UserAccount;
  projects: { id: number; name: string }[];
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<UserMembership | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function removeMembership(m: UserMembership) {
    onError(null);
    setBusy(true);
    try {
      await api.users.removeMembership(user.id, m.projectId);
      setRemoving(null);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRole() {
    onError(null);
    setBusy(true);
    try {
      await api.users.setRole(
        user.id,
        user.role === "admin" ? "member" : "admin",
      );
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "修改角色失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeUser() {
    onError(null);
    setBusy(true);
    try {
      await api.users.remove(user.id);
      setDeleting(false);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {user.name ?? user.email}
            <span className="ml-2">
              <RoleBadge role={user.role} />
            </span>
            {user.mustChangePassword ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                待修改初始密码
              </span>
            ) : null}
          </p>
          <p className="text-xs text-slate-500">{user.email}</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">
            创建于 {formatDateTime(user.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? "收起" : "添加项目"}
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy}
            onClick={() => void toggleRole()}
          >
            {user.role === "admin" ? "设为成员" : "设为管理员"}
          </button>
          <button
            type="button"
            className={btnDanger}
            onClick={() => setDeleting(true)}
          >
            删除账号
          </button>
        </div>
      </div>

      {/* 成员资格 chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        {user.memberships.length === 0 ? (
          <span className="text-xs text-slate-400">未加入任何项目</span>
        ) : (
          user.memberships.map((m) => (
            <span
              key={m.projectId}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1.5 text-xs text-slate-700"
            >
              <span className="font-medium">{m.projectName}</span>
              <button
                type="button"
                aria-label={`移除 ${m.projectName}`}
                className="rounded-full px-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                onClick={() => setRemoving(m)}
              >
                ✕
              </button>
            </span>
          ))
        )}
      </div>

      {adding ? (
        <AddProjectForm
          user={user}
          projects={projects}
          onDone={async () => {
            setAdding(false);
            await onChanged();
          }}
          onError={onError}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="移除成员资格"
          message={`确认将 ${user.email} 从项目「${removing.projectName}」中移除？`}
          confirmLabel="移除"
          busy={busy}
          onConfirm={() => void removeMembership(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="删除账号"
          message={`确认删除账号 ${user.email}？该操作不可撤销。`}
          confirmLabel="删除账号"
          busy={busy}
          onConfirm={() => void removeUser()}
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </div>
  );
}

/* ---------- 每用户：添加项目 ---------- */

function AddProjectForm({
  user,
  projects,
  onDone,
  onError,
}: {
  user: UserAccount;
  projects: { id: number; name: string }[];
  onDone: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  // 默认选中该用户尚未加入的第一个项目
  const available = projects.filter(
    (p) => !user.memberships.some((m) => m.projectId === p.id),
  );
  const [projectId, setProjectId] = useState<number>(
    available[0]?.id ?? projects[0]?.id ?? 0,
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    onError(null);
    setBusy(true);
    try {
      await api.users.upsertMembership(user.id, { projectId });
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "添加失败");
      setBusy(false);
    }
  }

  if (projects.length === 0) {
    return <p className="mt-3 text-xs text-slate-400">暂无项目可分配。</p>;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3"
    >
      <label className="block">
        <span className="mb-1 block text-xs text-slate-500">项目</span>
        <select
          className={`${selectCls} w-56`}
          value={projectId || ""}
          onChange={(e) => setProjectId(Number(e.target.value))}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {user.memberships.some((m) => m.projectId === p.id)
                ? "（已加入）"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "添加中…" : "添加"}
      </button>
    </form>
  );
}

/* ---------- 邀请用户 ---------- */

type Assignment = { projectId: number };

function CreateUserModal({
  projects,
  onClose,
  onCreated,
}: {
  projects: { id: number; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [assignments, setAssignments] = useState<Assignment[]>([
    { projectId: projects[0]?.id ?? 0 },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setRow(i: number, patch: Partial<Assignment>) {
    setAssignments((rows) =>
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const rows = assignments.filter((r) => r.projectId);
    if (rows.length === 0) {
      setError("至少分配一个项目");
      return;
    }
    if (new Set(rows.map((r) => r.projectId)).size !== rows.length) {
      setError("同一个项目只能分配一次，请合并重复行");
      return;
    }
    setBusy(true);
    try {
      await api.users.create({
        email,
        name: name || undefined,
        password,
        role,
        assignments: rows,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <Modal title="邀请用户" onClose={onClose} width="max-w-xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="邮箱">
            <input
              type="email"
              required
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="姓名（可选）">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="初始密码（至少 8 位）">
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="系统角色">
            <select
              className={selectCls}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </Field>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">项目分配</p>
          <div className="space-y-2">
            {assignments.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className={`${selectCls} min-w-0 flex-1`}
                  value={row.projectId || ""}
                  onChange={(e) =>
                    setRow(i, { projectId: Number(e.target.value) })
                  }
                >
                  {row.projectId ? null : (
                    <option value="" disabled>
                      选择项目
                    </option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="删除此行"
                  disabled={assignments.length <= 1}
                  className="shrink-0 rounded-lg px-2 py-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    setAssignments((rows) => rows.filter((_, j) => j !== i))
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-sm text-indigo-600 hover:underline disabled:text-slate-400"
            disabled={projects.length === 0}
            onClick={() =>
              setAssignments((rows) => [...rows, { projectId: 0 }])
            }
          >
            + 添加一行
          </button>
          {projects.length === 0 ? (
            <p className="mt-1 text-xs text-rose-600">暂无项目可分配。</p>
          ) : null}
        </div>

        <p className="text-xs text-slate-400">
          新用户首次登录后将被强制修改密码。
        </p>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "邀请中…" : "邀请"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
