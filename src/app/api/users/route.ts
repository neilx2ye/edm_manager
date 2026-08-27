import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { provisionAccount } from "@/lib/members";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

const PROJECT_ROLES = new Set(["owner", "admin", "editor", "viewer"]);

/** 当前用户是否在任一项目拥有 admin 及以上权限（全局用户管理的准入条件）。 */
async function isAnyProjectAdmin(userId: string): Promise<boolean> {
  return withUserContext(userId, async (_db, client) => {
    const res = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM edm.project_members pm
          WHERE pm.user_id = edm.current_user_id()
            AND pm.role IN ('admin', 'owner')
       ) AS is_admin`,
    );
    return res.rows[0]?.is_admin === true;
  });
}

/** 列出全部账号及其在「当前用户可见项目」中的成员资格。 */
export const GET = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  if (!(await isAnyProjectAdmin(userOrErr.id))) {
    return err(403, "需要任一项目的 admin 及以上角色");
  }

  const users = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `SELECT u.id::text AS id, u.email::text AS email, u.name,
              u.must_change_password, u."createdAt" AS created_at,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'projectId', p.id,
                    'projectName', p.name,
                    'role', pm.role
                  ) ORDER BY p.name
                ) FILTER (WHERE pm.user_id IS NOT NULL),
                '[]'::jsonb
              ) AS memberships
         FROM auth.users u
         LEFT JOIN edm.project_members pm ON pm.user_id = u.id
         LEFT JOIN edm.projects p ON p.id = pm.project_id
        GROUP BY u.id
        ORDER BY u."createdAt" ASC, u.email ASC`,
    );
    return res.rows;
  });
  return ok(users);
});

/** 创建（或复用）账号，并为其分配一个或多个项目角色。 */
export const POST = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : null;
  const password = typeof body?.password === "string" ? body.password : "";
  const assignments = Array.isArray(body?.assignments)
    ? (body.assignments as {
        projectId?: unknown;
        role?: unknown;
      }[])
    : [];

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, "邮箱格式不正确");
  if (password.length < 8) return err(400, "初始密码至少 8 位");
  if (assignments.length === 0) return err(400, "请至少分配一个项目");
  for (const a of assignments) {
    const pid = parseId(a.projectId as unknown);
    const role = typeof a.role === "string" ? a.role : "";
    if (!pid || !PROJECT_ROLES.has(role)) return err(400, "项目分配参数无效");
  }

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const account = await provisionAccount(client, email, name, password);

    // 先校验所有目标项目的管理权限（任一失败则整体拒绝）
    const normalized = assignments.map((a) => ({
      projectId: parseId(a.projectId as unknown)!,
      role: String(a.role),
    }));
    for (const a of normalized) {
      const perm = await client.query(
        `SELECT edm.is_member($1, 'admin') AS is_admin,
                edm.is_member($1, 'owner') AS is_owner`,
        [a.projectId],
      );
      if (perm.rows[0]?.is_admin !== true) {
        return { error: `无权管理项目 ${a.projectId} 的成员` };
      }
      if (a.role === "owner" && perm.rows[0]?.is_owner !== true) {
        return { error: `仅项目 ${a.projectId} 的 owner 可授予 owner 角色` };
      }
    }

    const done: { projectId: number; role: string; projectName: string }[] = [];
    for (const a of normalized) {
      await client.query(
        `INSERT INTO edm.project_members (project_id, user_id, role, invited_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [a.projectId, account.userId, a.role, userOrErr.id],
      );
      const pname = await client.query(
        "SELECT name FROM edm.projects WHERE id = $1",
        [a.projectId],
      );
      done.push({
        projectId: a.projectId,
        role: a.role,
        projectName: pname.rows[0]?.name ?? "",
      });
    }
    return { account, assignments: done };
  });

  if ("error" in result) return err(403, result.error as string);

  await writeAudit({
    projectId: null,
    actorId: userOrErr.id,
    action: result.account.existed ? "user.updated" : "user.created",
    entityType: "user",
    payload: {
      email,
      assignments: result.assignments.map((a) => ({
        projectId: a.projectId,
        role: a.role,
      })),
    },
  });

  return ok(
    {
      id: result.account.userId,
      email,
      name,
      mustChangePassword: true,
      memberships: result.assignments,
    },
    201,
  );
});
