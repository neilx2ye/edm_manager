import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, requireUser } from "@/lib/api";
import { isGlobalAdmin } from "@/db/context";
import { servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 移除用户在某项目中的成员资格（仅系统管理员）。 */
export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; projectId: string }> },
) => {
  const { userId, projectId } = await params;
  const pid = parseId(projectId);
  if (!userId || !pid) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  if (!(await isGlobalAdmin(userOrErr.id))) {
    return err(403, "仅系统管理员可管理用户");
  }

  const res = await servicePool.query(
    "DELETE FROM edm.project_members WHERE project_id = $1 AND user_id = $2",
    [pid, userId],
  );
  if (res.rowCount === 0) return err(404, "成员资格不存在");

  await writeAudit({
    projectId: pid,
    actorId: userOrErr.id,
    action: "user.project_unassigned",
    entityType: "project",
    entityId: pid,
    payload: { userId },
  });
  return ok({ ok: true });
});
