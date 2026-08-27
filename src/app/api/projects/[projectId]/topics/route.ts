import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withAgentContext, withUserContext, type Db } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";
import type { PoolClient } from "pg";

export const GET = route(async (
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(_req);
  if (requester.kind === "anon") return err(401, "认证失败");
  if (requester.kind === "agent" && requester.key.projectId !== id) {
    return err(403, "API key 无权访问该项目");
  }

  const listTopics = async (_db: Db, client: PoolClient) => {
    const res = await client.query(
      `SELECT tp.id, tp.project_id AS project_id, tp.name, tp.purpose,
              tp.created_by::text AS created_by, tp.created_at, tp.updated_at,
              (SELECT count(*) FROM edm.templates t WHERE t.topic_id = tp.id)::int AS template_count
         FROM edm.topics tp
        WHERE tp.project_id = $1
        ORDER BY tp.created_at ASC, tp.id ASC`,
      [id],
    );
    return res.rows;
  };

  const topics =
    requester.kind === "user"
      ? await withUserContext(requester.user.id, listTopics)
      : await withAgentContext(id, listTopics);

  return ok(topics);
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

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return err(400, "主题名称不能为空");
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim() : null;

  const topic = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `INSERT INTO edm.topics (project_id, name, purpose, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, project_id AS project_id, name, purpose,
                 created_by::text AS created_by, created_at, updated_at`,
      [id, name, purpose, userOrErr.id],
    );
    return res.rows[0];
  });

  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "topic.created",
    entityType: "topic",
    entityId: Number(topic.id),
    payload: { name },
  });
  return ok({ ...topic, templateCount: 0 }, 201);
});
