import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, requireUser } from "@/lib/api";
import { isGlobalAdmin } from "@/db/context";
import { servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 移除项目成员（仅系统管理员）。 */
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
  if (!(await isGlobalAdmin(userOrErr.id))) {
    return err(403, "仅系统管理员可管理用户");
  }

  const res = await servicePool.query(
    "DELETE FROM edm.project_members WHERE project_id = $1 AND user_id = $2",
    [id, userId],
  );
  if (res.rowCount === 0) return err(404, "成员不存在");

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
