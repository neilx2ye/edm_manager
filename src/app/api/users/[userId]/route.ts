import { NextRequest } from "next/server";
import { err, getRequester, ok, requireUser } from "@/lib/api";
import { appPool, servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 删除账号（保留业务历史：created_by 等置空；成员资格级联移除）。 */
export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) => {
  const { userId } = await params;
  if (!userId) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  const actor = userOrErr;

  // 准入：任一项目 admin 及以上（服务端角色直查，不受 RLS 限制）
  const adminRes = await servicePool.query(
    `SELECT EXISTS (
       SELECT 1 FROM edm.project_members
        WHERE user_id = $1 AND role IN ('admin', 'owner')
     ) AS ok`,
    [actor.id],
  );
  if (adminRes.rows[0]?.ok !== true) {
    return err(403, "需要任一项目的 admin 及以上角色");
  }

  if (userId === actor.id) return err(403, "不能删除自己的账号");

  const target = await servicePool.query(
    "SELECT email::text AS email FROM auth.users WHERE id = $1",
    [userId],
  );
  if (target.rowCount === 0) return err(404, "账号不存在");

  // 该用户不能是任何项目的 owner（projects.owner_id 或 project_members.owner）
  const owns = await servicePool.query(
    `SELECT 1
      WHERE EXISTS (SELECT 1 FROM edm.projects WHERE owner_id = $1)
         OR EXISTS (SELECT 1 FROM edm.project_members
                     WHERE user_id = $1 AND role = 'owner')`,
    [userId],
  );
  if (owns.rowCount === 1) {
    return err(403, "该用户是项目 owner，请先转移或删除其所属项目");
  }

  await appPool.query("DELETE FROM auth.users WHERE id = $1", [userId]);

  await writeAudit({
    projectId: null,
    actorId: actor.id,
    action: "user.deleted",
    entityType: "user",
    payload: { userId, email: target.rows[0].email },
  });
  return ok({ ok: true });
});
