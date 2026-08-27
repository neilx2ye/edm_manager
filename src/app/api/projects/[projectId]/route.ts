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

export const GET = route(async (
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(_req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const project = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `SELECT p.id, p.name, p.description,
              p.owner_id::text AS owner_id,
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
        WHERE p.id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  });

  if (!project) return err(404, "项目不存在或无权访问");
  return ok({
    ...project,
    myRole: RANK_TO_ROLE[project.role_rank] ?? "viewer",
    role_rank: undefined,
  });
});

export const PATCH = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const description =
    typeof body?.description === "string" ? body.description.trim() : undefined;
  const agentCanApprove =
    typeof body?.agentCanApprove === "boolean" ? body.agentCanApprove : undefined;

  const updated = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `UPDATE edm.projects
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              agent_can_approve = COALESCE($4, agent_can_approve),
              updated_at = now()
        WHERE id = $1
        RETURNING id, name, description, owner_id::text,
                  agent_can_approve, updated_at`,
      [id, name ?? null, description ?? null, agentCanApprove ?? null],
    );
    return res.rows[0] ?? null;
  });
  if (!updated) return err(404, "项目不存在或无权修改");

  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "project.updated",
    entityType: "project",
    entityId: id,
    payload: { name, description, agentCanApprove },
  });
  return ok(updated);
});

export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const deleted = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      "DELETE FROM edm.projects WHERE id = $1 RETURNING id, name",
      [id],
    );
    return res.rows[0] ?? null;
  });
  if (!deleted) return err(404, "项目不存在或非 owner 无权删除");

  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "project.deleted",
    entityType: "project",
    entityId: id,
    payload: { name: deleted.name },
  });
  return ok({ ok: true });
});
