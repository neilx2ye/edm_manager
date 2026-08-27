import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

const PROJECT_ROLES = new Set(["admin", "member"]);

export const PATCH = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; userId: string }> },
) => {
  const { projectId, userId } = await params;
  const id = parseId(projectId);
  if (!id || !userId) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const role = typeof body?.role === "string" ? body.role : "";
  if (!PROJECT_ROLES.has(role)) return err(400, "无效角色");

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `UPDATE edm.project_members SET role = $3
        WHERE project_id = $1 AND user_id = $2
        RETURNING user_id::text, role`,
      [id, userId, role],
    );
    if (res.rowCount === 0) return { error: "成员不存在" };
    return { member: res.rows[0] };
  });

  if ("error" in result) return err(403, result.error as string);
  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "project.member_role_changed",
    entityType: "project",
    entityId: id,
    payload: { userId, role },
  });
  return ok(result.member);
});

export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; userId: string }> },
) => {
  const { projectId, userId } = await params;
  const id = parseId(projectId);
  if (!id || !userId) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      "DELETE FROM edm.project_members WHERE project_id = $1 AND user_id = $2",
      [id, userId],
    );
    if (res.rowCount === 0) return { error: "成员不存在" };
    return { ok: true };
  });

  if ("error" in result) return err(403, result.error as string);
  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "project.member_removed",
    entityType: "project",
    entityId: id,
    payload: { userId },
  });
  return ok({ ok: true });
});
