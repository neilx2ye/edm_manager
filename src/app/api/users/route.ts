import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { isGlobalAdmin } from "@/db/context";
import { servicePool } from "@/db/pools";
import { provisionAccount } from "@/lib/members";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 列出全部账号、系统角色与项目成员资格（仅系统管理员）。 */
export const GET = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  if (!(await isGlobalAdmin(userOrErr.id))) {
    return err(403, "仅系统管理员可管理用户");
  }

  const res = await servicePool.query(
    `SELECT u.id::text AS id, u.email::text AS email, u.name, u.role,
            u.must_change_password, u."createdAt" AS created_at,
            COALESCE(
              jsonb_agg(
                jsonb_build_object('projectId', p.id, 'projectName', p.name)
                ORDER BY p.name
              ) FILTER (WHERE pm.user_id IS NOT NULL),
              '[]'::jsonb
            ) AS memberships
       FROM auth.users u
       LEFT JOIN edm.project_members pm ON pm.user_id = u.id
       LEFT JOIN edm.projects p ON p.id = pm.project_id
      GROUP BY u.id
      ORDER BY u."createdAt" ASC, u.email ASC`,
  );
  return ok(res.rows);
});

/** 邀请（或复用）账号，并为其分配项目（仅系统管理员）。 */
export const POST = route(async (req: NextRequest) => {
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
  const role = body?.role === "admin" ? "admin" : "member";
  const rawProjectIds = Array.isArray(body?.assignments)
    ? (body.assignments as { projectId?: unknown }[])
    : [];
  const projectIds = [
    ...new Set(
      rawProjectIds
        .map((a) => parseId(a.projectId as unknown))
        .filter((id): id is number => id !== null),
    ),
  ];

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, "邮箱格式不正确");
  if (password.length < 8) return err(400, "初始密码至少 8 位");
  if (projectIds.length === 0) return err(400, "请至少分配一个项目");

  const projects = await servicePool.query(
    "SELECT id, name FROM edm.projects WHERE id = ANY($1::bigint[])",
    [projectIds],
  );
  if (projects.rowCount !== projectIds.length) return err(400, "包含不存在的项目");

  const client = await servicePool.connect();
  try {
    const account = await provisionAccount(client, email, name, password, role);
    for (const projectId of projectIds) {
      await client.query(
        `INSERT INTO edm.project_members (project_id, user_id, invited_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [projectId, account.userId, userOrErr.id],
      );
    }

    await writeAudit({
      projectId: null,
      actorId: userOrErr.id,
      action: account.existed ? "user.updated" : "user.created",
      entityType: "user",
      payload: { email, role, projectIds },
    });

    return ok(
      {
        id: account.userId,
        email,
        name,
        role,
        mustChangePassword: true,
        memberships: projects.rows.map((p) => ({
          projectId: Number(p.id),
          projectName: p.name,
        })),
      },
      201,
    );
  } finally {
    client.release();
  }
});
