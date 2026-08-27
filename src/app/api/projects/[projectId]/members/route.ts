import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { provisionAccount } from "@/lib/members";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

const PROJECT_ROLES = new Set(["owner", "admin", "editor", "viewer"]);

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

  const members = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `SELECT pm.user_id::text, pm.role, pm.joined_at,
              u.email::text AS email, u.name, u.must_change_password
         FROM edm.project_members pm
         JOIN auth.users u ON u.id = pm.user_id
        WHERE pm.project_id = $1
        ORDER BY pm.joined_at ASC`,
      [id],
    );
    return res.rows;
  });
  return ok(members);
});

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

  // 先做权限判定，避免向无权者泄露表单校验细节
  const permission = await withUserContext(
    userOrErr.id,
    async (_db, client) =>
      (
        await client.query(
          "SELECT edm.is_member($1, 'admin') AS is_admin, edm.is_member($1, 'owner') AS is_owner",
          [id],
        )
      ).rows[0] as { is_admin: boolean; is_owner: boolean },
  );
  if (!permission?.is_admin) return err(403, "无权管理项目成员");

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "viewer";
  const name = typeof body?.name === "string" ? body.name.trim() : null;
  const password =
    typeof body?.password === "string" ? body.password : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, "邮箱格式不正确");
  if (!PROJECT_ROLES.has(role)) return err(400, "无效角色");
  if (password.length < 8) return err(400, "初始密码至少 8 位");

  if (role === "owner" && !permission.is_owner) {
    return err(403, "仅 owner 可授予 owner 角色");
  }

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const account = await provisionAccount(client, email, name, password);
    const res = await client.query(
      `INSERT INTO edm.project_members (project_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING user_id::text, role, joined_at`,
      [id, account.userId, role, userOrErr.id],
    );
    return { member: res.rows[0], account };
  });

  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "project.member_added",
    entityType: "project",
    entityId: id,
    payload: { email, role },
  });
  return ok(
    {
      ...result.member,
      email,
    },
    201,
  );
});
