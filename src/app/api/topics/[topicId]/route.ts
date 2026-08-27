import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

export const GET = route(async (
  _req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> },
) => {
  const { topicId } = await params;
  const id = parseId(topicId);
  if (!id) return err(400, "无效主题 ID");

  const requester = await getRequester(_req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const topic = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `SELECT tp.id, tp.project_id AS project_id, tp.name, tp.purpose,
              tp.created_by::text AS created_by, tp.created_at, tp.updated_at,
              (SELECT count(*) FROM edm.templates t WHERE t.topic_id = tp.id)::int AS template_count
         FROM edm.topics tp
        WHERE tp.id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  });
  if (!topic) return err(404, "主题不存在或无权访问");
  return ok(topic);
});

export const PATCH = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> },
) => {
  const { topicId } = await params;
  const id = parseId(topicId);
  if (!id) return err(400, "无效主题 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const purpose =
    typeof body?.purpose === "string" ? body.purpose.trim() : undefined;
  if (name === "" || purpose === "") return err(400, "名称/用途不能为空");

  const topic = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `UPDATE edm.topics
          SET name = COALESCE($2, name),
              purpose = COALESCE($3, purpose),
              updated_at = now()
        WHERE id = $1
        RETURNING id, project_id AS project_id, name, purpose, updated_at`,
      [id, name ?? null, purpose ?? null],
    );
    return res.rows[0] ?? null;
  });
  if (!topic) return err(404, "主题不存在或无权修改");
  return ok(topic);
});

export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> },
) => {
  const { topicId } = await params;
  const id = parseId(topicId);
  if (!id) return err(400, "无效主题 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const deleted = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `DELETE FROM edm.topics WHERE id = $1
       RETURNING id, name, project_id AS project_id`,
      [id],
    );
    return res.rows[0] ?? null;
  });
  if (!deleted) return err(404, "主题不存在或无权删除");

  await writeAudit({
    projectId: Number(deleted.project_id),
    actorId: userOrErr.id,
    action: "topic.deleted",
    entityType: "topic",
    entityId: id,
    payload: { name: deleted.name },
  });
  return ok({ ok: true });
});
