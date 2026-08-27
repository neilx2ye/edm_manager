import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

/** 模板在主题间移动/复制（跨项目即更换到目标项目的主题）。 */
export const POST = route(async (
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
  const targetTopic = parseId(body?.topicId as unknown);
  if (!targetTopic) return err(400, "目标主题 ID 无效");
  const copy = body?.copy === true;

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    if (copy) {
      const src = await client.query(
        "SELECT name, purpose, tags FROM edm.templates WHERE id = $1",
        [id],
      );
      if (src.rowCount === 0) return { error: "模板不存在或无权访问" };
      const t = src.rows[0];
      const created = await client.query(
        `INSERT INTO edm.templates (topic_id, name, purpose, tags, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [targetTopic, `${t.name} (副本)`, t.purpose, t.tags, userOrErr.id],
      );
      const newId = created.rows[0].id;
      await client.query(
        `INSERT INTO edm.versions
           (template_id, html, source, note, status, created_by)
         SELECT $1, html, source, note, status, $2
           FROM edm.versions WHERE template_id = $3
         ORDER BY created_at ASC`,
        [newId, userOrErr.id, id],
      );
      return { moved: false, templateId: newId };
    }

    const res = await client.query(
      `UPDATE edm.templates SET topic_id = $2, updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [id, targetTopic],
    );
    if (res.rowCount === 0) return { error: "模板不存在或无权操作" };
    return { moved: true, templateId: id };
  });

  if ("error" in result) return err(403, result.error as string);
  const targetProject = await topicProject(targetTopic);
  await writeAudit({
    projectId: targetProject ?? null,
    actorId: userOrErr.id,
    action: copy ? "template.copied" : "template.moved",
    entityType: "template",
    entityId: id,
    payload: { targetTopic },
  });
  return ok(result);
});

async function topicProject(topicId: number): Promise<number | null> {
  const res = await servicePool.query(
    "SELECT project_id AS project_id FROM edm.topics WHERE id = $1",
    [topicId],
  );
  return res.rowCount === 1 ? Number(res.rows[0].project_id) : null;
}
