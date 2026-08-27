import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

const PROJECT_ROLES = new Set(["owner", "admin", "editor", "viewer"]);

/** 为用户新增/更新某个项目中的角色（全局用户管理）。 */
export const PUT = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) => {
  const { userId } = await params;
  if (!userId) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const projectId = parseId(body?.projectId as unknown);
  const role = typeof body?.role === "string" ? body.role : "";
  if (!projectId || !PROJECT_ROLES.has(role)) return err(400, "参数无效");

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const perm = await client.query(
      `SELECT edm.is_member($1, 'admin') AS is_admin,
              edm.is_member($1, 'owner') AS is_owner`,
      [projectId],
    );
    if (perm.rows[0]?.is_admin !== true) return { error: "无权管理该项目成员" };
    if (role === "owner" && perm.rows[0]?.is_owner !== true) {
      return { error: "仅项目 owner 可授予 owner 角色" };
    }
    const res = await client.query(
      `INSERT INTO edm.project_members (project_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING project_id AS project_id, user_id::text AS user_id, role`,
      [projectId, userId, role, userOrErr.id],
    );
    return { membership: res.rows[0] };
  });

  if ("error" in result) return err(403, result.error as string);
  await writeAudit({
    projectId,
    actorId: userOrErr.id,
    action: "project.member_role_changed",
    entityType: "project",
    entityId: projectId,
    payload: { userId, role },
  });
  return ok(result.membership);
});
