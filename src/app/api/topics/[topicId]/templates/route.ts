import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 在主题下创建模板（可同时提交首个版本）。 */
export const POST = route(async (
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
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return err(400, "模板名称不能为空");
  const purpose =
    typeof body?.purpose === "string" ? body.purpose.trim() : null;
  const tags = Array.isArray(body?.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const html = typeof body?.html === "string" ? body.html : null;
  const source = typeof body?.source === "string" ? body.source : null;
  const note = typeof body?.note === "string" ? body.note : null;

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const projectRes = await client.query(
      "SELECT edm.topic_project($1) AS project_id",
      [id],
    );
    const projectId = Number(projectRes.rows[0]?.project_id);

    const res = await client.query(
      `INSERT INTO edm.templates (topic_id, name, purpose, tags, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, topic_id AS topic_id, name, purpose, tags, status, created_at`,
      [id, name, purpose, tags, userOrErr.id],
    );
    const template = res.rows[0];
    let version = null;
    if (html !== null) {
      const vres = await client.query(
        `INSERT INTO edm.versions (template_id, html, source, note, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, status, created_at`,
        [template.id, html, source, note, userOrErr.id],
      );
      version = vres.rows[0];
    }
    return { template, version, projectId };
  });

  await writeAudit({
    projectId: result.projectId,
    actorId: userOrErr.id,
    action: "template.created",
    entityType: "template",
    entityId: Number(result.template.id),
    payload: { name, topicId: id },
  });
  return ok(
    { template: result.template, version: result.version },
    201,
  );
});
