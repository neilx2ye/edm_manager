import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { isGlobalAdmin } from "@/db/context";
import { servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 为用户分配项目（仅系统管理员）。 */
export const PUT = route(async (
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

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const projectId = parseId(body?.projectId as unknown);
  if (!projectId) return err(400, "参数无效");

  const target = await servicePool.query(
    "SELECT 1 FROM auth.users WHERE id = $1",
    [userId],
  );
  if (target.rowCount === 0) return err(404, "账号不存在");

  const project = await servicePool.query(
    "SELECT id, name FROM edm.projects WHERE id = $1",
    [projectId],
  );
  if (project.rowCount === 0) return err(404, "项目不存在");

  await servicePool.query(
    `INSERT INTO edm.project_members (project_id, user_id, invited_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO NOTHING`,
    [projectId, userId, userOrErr.id],
  );

  await writeAudit({
    projectId,
    actorId: userOrErr.id,
    action: "user.project_assigned",
    entityType: "project",
    entityId: projectId,
    payload: { userId },
  });
  return ok({
    projectId,
    projectName: project.rows[0].name,
  });
});
