import { NextRequest } from "next/server";
import { err, getRequester, ok, readJson, requireUser } from "@/lib/api";
import { isGlobalAdmin } from "@/db/context";
import { servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

const ROLES = new Set(["admin", "member"]);

/** 修改用户系统角色（仅系统管理员，不能修改自己）。 */
export const PATCH = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) => {
  const { userId } = await params;
  if (!userId) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  if (!(await isGlobalAdmin(userOrErr.id))) {
    return err(403, "仅系统管理员可管理用户");
  }
  if (userId === userOrErr.id) return err(403, "不能修改自己的角色");

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const role = typeof body?.role === "string" ? body.role : "";
  if (!ROLES.has(role)) return err(400, "无效角色");

  const res = await servicePool.query(
    "UPDATE auth.users SET role = $2 WHERE id = $1 RETURNING id::text, role",
    [userId, role],
  );
  if (res.rowCount === 0) return err(404, "账号不存在");

  await writeAudit({
    projectId: null,
    actorId: userOrErr.id,
    action: "user.role_changed",
    entityType: "user",
    payload: { userId, role },
  });
  return ok(res.rows[0]);
});

/** 删除账号（保留业务历史；项目创建者账号不可删）。 */
export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) => {
  const { userId } = await params;
  if (!userId) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  if (!(await isGlobalAdmin(userOrErr.id))) {
    return err(403, "仅系统管理员可管理用户");
  }
  if (userId === userOrErr.id) return err(403, "不能删除自己的账号");

  const target = await servicePool.query(
    "SELECT email::text AS email FROM auth.users WHERE id = $1",
    [userId],
  );
  if (target.rowCount === 0) return err(404, "账号不存在");

  const owns = await servicePool.query(
    "SELECT 1 FROM edm.projects WHERE owner_id = $1 LIMIT 1",
    [userId],
  );
  if (owns.rowCount === 1) {
    return err(403, "该用户是项目创建者，请先转移或删除其项目");
  }

  await servicePool.query("DELETE FROM auth.users WHERE id = $1", [userId]);

  await writeAudit({
    projectId: null,
    actorId: userOrErr.id,
    action: "user.deleted",
    entityType: "user",
    payload: { userId, email: target.rows[0].email },
  });
  return ok({ ok: true });
});
