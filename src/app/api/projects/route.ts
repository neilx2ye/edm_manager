import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

const RANK_TO_ROLE: Record<number, string> = {
  1: "viewer",
  2: "editor",
  3: "admin",
  4: "owner",
};

export const GET = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const projects = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `SELECT p.id, p.name, p.description,
              p.owner_id::text,
              p.agent_can_approve,
              p.created_at, p.updated_at,
              COALESCE((SELECT edm.role_rank(pm.role)
                         FROM edm.project_members pm
                        WHERE pm.project_id = p.id
                          AND pm.user_id = edm.current_user_id()), 0)::int AS role_rank,
              (SELECT count(*)
                 FROM edm.templates t
                 JOIN edm.topics tp ON tp.id = t.topic_id
                WHERE tp.project_id = p.id)::int AS template_count,
              (SELECT count(*) FROM edm.topics tp WHERE tp.project_id = p.id)::int AS topic_count
         FROM edm.projects p
        WHERE edm.is_member(p.id, 'viewer')
        ORDER BY p.updated_at DESC`,
    );
    return res.rows;
  });

  return ok(
    projects.map((p) => ({
      ...p,
      myRole: RANK_TO_ROLE[p.role_rank] ?? "viewer",
      role_rank: undefined,
    })),
  );
});

export const POST = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return err(400, "项目名称不能为空");
  const description =
    typeof body?.description === "string" ? body.description.trim() : null;
  const agentCanApprove =
    typeof body?.agentCanApprove === "boolean" ? body.agentCanApprove : true;

  const project = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `INSERT INTO edm.projects
         (name, description, owner_id, agent_can_approve)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, owner_id::text,
                 agent_can_approve, created_at`,
      [name, description, userOrErr.id, agentCanApprove],
    );
    const created = res.rows[0];
    await client.query(
      `INSERT INTO edm.project_members (project_id, user_id, role, invited_by)
       VALUES ($1, $2, 'owner', $2)`,
      [created.id, userOrErr.id],
    );
    return created;
  });

  await writeAudit({
    projectId: Number(project.id),
    actorId: userOrErr.id,
    action: "project.created",
    entityType: "project",
    entityId: Number(project.id),
    payload: { name },
  });
  return ok(project, 201);
});
