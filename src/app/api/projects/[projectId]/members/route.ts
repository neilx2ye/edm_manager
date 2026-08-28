import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { checkMembership, isGlobalAdmin } from "@/db/context";
import { servicePool } from "@/db/pools";
import { provisionAccount } from "@/lib/members";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 项目成员名单（项目成员或系统管理员可看）。 */
export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const allowed =
    (await isGlobalAdmin(userOrErr.id)) ||
    (await checkMembership(userOrErr.id, id));
  if (!allowed) return err(403, "无权查看项目成员");

  const res = await servicePool.query(
    `SELECT pm.user_id::text AS user_id, pm.joined_at,
            u.email::text AS email, u.name, u.must_change_password
       FROM edm.project_members pm
       JOIN auth.users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY pm.joined_at ASC`,
    [id],
  );
  return ok(res.rows);
});

/** 邀请用户加入项目（仅系统管理员）。 */
export const POST = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  if (!(await isGlobalAdmin(userOrErr.id))) {
    return err(403, "仅系统管理员可管理用户");
  }

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, "邮箱格式不正确");
  if (password.length < 8) return err(400, "初始密码至少 8 位");

  const project = await servicePool.query(
    "SELECT id, name FROM edm.projects WHERE id = $1",
    [id],
  );
  if (project.rowCount === 0) return err(404, "项目不存在");

  const client = await servicePool.connect();
  try {
    const account = await provisionAccount(client, email, name, password);
    const res = await client.query(
      `INSERT INTO edm.project_members (project_id, user_id, invited_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO NOTHING
       RETURNING user_id::text AS user_id, joined_at`,
      [id, account.userId, userOrErr.id],
    );

    await writeAudit({
      projectId: id,
      actorId: userOrErr.id,
      action: "project.member_added",
      entityType: "project",
      entityId: id,
      payload: { email },
    });
    return ok(
      {
        userId: account.userId,
        joinedAt: res.rows[0]?.joined_at ?? null,
        email,
      },
      201,
    );
  } finally {
    client.release();
  }
});
