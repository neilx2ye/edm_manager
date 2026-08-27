import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 移除用户在某项目中的成员资格（全局用户管理）。 */
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

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const isAdmin = (
      await client.query("SELECT edm.is_member($1, 'admin') AS ok", [pid])
    ).rows[0]?.ok;
    if (isAdmin !== true) return { error: "无权管理该项目成员" };

    // 不能移除项目最后一个 owner
    const ownerCount = await client.query(
      `SELECT count(*)::int AS c FROM edm.project_members
        WHERE project_id = $1 AND role = 'owner' AND user_id <> $2`,
      [pid, userId],
    );
    const targetIsOwner = await client.query(
      `SELECT 1 FROM edm.project_members
        WHERE project_id = $1 AND user_id = $2 AND role = 'owner'`,
      [pid, userId],
    );
    if (targetIsOwner.rowCount === 1 && ownerCount.rows[0].c === 0) {
      return { error: "不能移除项目最后一个 owner" };
    }

    const res = await client.query(
      "DELETE FROM edm.project_members WHERE project_id = $1 AND user_id = $2",
      [pid, userId],
    );
    if (res.rowCount === 0) return { error: "成员资格不存在" };
    return { ok: true };
  });

  if ("error" in result) return err(403, result.error as string);
  await writeAudit({
    projectId: pid,
    actorId: userOrErr.id,
    action: "project.member_removed",
    entityType: "project",
    entityId: pid,
    payload: { userId },
  });
  return ok({ ok: true });
});
