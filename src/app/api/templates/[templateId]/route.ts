import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) => {
  const { templateId } = await params;
  const id = parseId(templateId);
  if (!id) return err(400, "无效模板 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const row = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `SELECT t.id, t.topic_id AS topic_id, tp.project_id AS project_id,
              tp.name AS topic_name,
              t.name, t.purpose, t.tags, t.status,
              t.created_by::text, t.created_at, t.updated_at,
              p.name AS project_name, p.agent_can_approve
         FROM edm.templates t
         JOIN edm.topics tp ON tp.id = t.topic_id
         JOIN edm.projects p ON p.id = tp.project_id
        WHERE t.id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  });
  if (!row) return err(404, "模板不存在或无权访问");
  return ok(row);
});

export const PATCH = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) => {
  const { templateId } = await params;
  const id = parseId(templateId);
  if (!id) return err(400, "无效模板 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const purpose =
    typeof body?.purpose === "string" ? body.purpose.trim() : undefined;
  const tags = Array.isArray(body?.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  const status =
    body?.status === "active" || body?.status === "archived"
      ? body.status
      : undefined;

  const updated = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `UPDATE edm.templates
          SET name = COALESCE($2, name),
              purpose = COALESCE($3, purpose),
              tags = COALESCE($4, tags),
              status = COALESCE($5, status),
              updated_at = now()
        WHERE id = $1
        RETURNING id, topic_id AS topic_id, name, purpose, tags, status, updated_at`,
      [id, name ?? null, purpose ?? null, tags ?? null, status ?? null],
    );
    return res.rows[0] ?? null;
  });
  if (!updated) return err(404, "模板不存在或无权修改");
  return ok(updated);
});

export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) => {
  const { templateId } = await params;
  const id = parseId(templateId);
  if (!id) return err(400, "无效模板 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const deleted = await withUserContext(userOrErr.id, async (_db, client) => {
    const projRes = await client.query(
      "SELECT edm.template_project($1) AS project_id",
      [id],
    );
    const res = await client.query(
      "DELETE FROM edm.templates WHERE id = $1 RETURNING id, name",
      [id],
    );
    return res.rowCount === 1
      ? { ...res.rows[0], project_id: projRes.rows[0]?.project_id }
      : null;
  });
  if (!deleted) return err(404, "模板不存在或无权删除");

  await writeAudit({
    projectId: Number(deleted.project_id),
    actorId: userOrErr.id,
    action: "template.deleted",
    entityType: "template",
    entityId: id,
    payload: { name: deleted.name },
  });
  return ok({ ok: true });
});
