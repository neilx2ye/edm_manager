import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId } from "@/lib/api";
import { withAgentContext, withUserContext } from "@/db/context";
import { servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

export const POST = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string; versionId: string }> },
) => {
  const { templateId, versionId } = await params;
  const tid = parseId(templateId);
  const vid = parseId(versionId);
  if (!tid || !vid) return err(400, "参数无效");

  const requester = await getRequester(req);

  if (requester.kind === "user") {
    const updated = await withUserContext(
      requester.user.id,
      async (_db, client) => {
        const res = await client.query(
          `UPDATE edm.versions
              SET status = 'saved'
            WHERE id = $1 AND template_id = $2 AND status = 'draft'
            RETURNING id, status, template_id::bigint`,
          [vid, tid],
        );
        return res.rows[0] ?? null;
      },
    );
    if (!updated) return err(404, "版本不存在、已是 saved 或无权采纳");
    await writeAudit({
      projectId: await templateProject(tid),
      actorId: requester.user.id,
      action: "version.approved",
      entityType: "version",
      entityId: vid,
      payload: { templateId: tid },
    });
    return ok(updated);
  }

  if (requester.kind === "agent") {
    const project = await templateProject(tid);
    if (!project) return err(404, "模板不存在");
    if (project !== requester.key.projectId) {
      return err(403, "API key 与模板项目不匹配");
    }
    const updated = await withAgentContext(project, async (_db, client) => {
      const res = await client.query(
        `UPDATE edm.versions
            SET status = 'saved'
          WHERE id = $1 AND template_id = $2 AND status = 'draft'
          RETURNING id, status, template_id::bigint`,
        [vid, tid],
      );
      return res.rows[0] ?? null;
    });
    if (!updated) {
      return err(403, "采纳被拒绝：agent_can_approve 关闭或版本状态不允许");
    }
    await writeAudit({
      projectId: project,
      actorId: null,
      action: "version.approved_by_agent",
      entityType: "version",
      entityId: vid,
      payload: { templateId: tid, apiKeyId: requester.key.keyId },
    });
    return ok(updated);
  }

  return err(401, "认证失败");
});

async function templateProject(templateId: number): Promise<number | null> {
  const res = await servicePool.query(
    `SELECT tp.project_id AS project_id
       FROM edm.templates t
       JOIN edm.topics tp ON tp.id = t.topic_id
      WHERE t.id = $1`,
    [templateId],
  );
  return res.rowCount === 1 ? Number(res.rows[0].project_id) : null;
}
