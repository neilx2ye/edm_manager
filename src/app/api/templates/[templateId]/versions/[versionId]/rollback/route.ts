import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { servicePool } from "@/db/pools";
import { route } from "@/lib/route";

/** 回滚 = 复制历史版本为新版本（版本不可变，保留全量历史）。仅限人工。 */
export const POST = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string; versionId: string }> },
) => {
  const { templateId, versionId } = await params;
  const tid = parseId(templateId);
  const vid = parseId(versionId);
  if (!tid || !vid) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const result = await withUserContext(userOrErr.id, async (_db, client) => {
    const old = await client.query(
      `SELECT html, source, status FROM edm.versions
        WHERE id = $1 AND template_id = $2`,
      [vid, tid],
    );
    if (old.rowCount === 0) return { error: "历史版本不存在或无权访问" };
    const src = old.rows[0];
    const res = await client.query(
      `INSERT INTO edm.versions
         (template_id, html, source, note, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, template_id::bigint, status, note, created_at`,
      [
        tid,
        src.html,
        src.source,
        `回滚自版本 #${vid}`,
        src.status,
        userOrErr.id,
      ],
    );
    return { version: res.rows[0] };
  });

  if ("error" in result) return err(403, result.error as string);
  await writeAudit({
    projectId: await templateProject(tid),
    actorId: userOrErr.id,
    action: "version.rollback",
    entityType: "version",
    entityId: Number(result.version.id),
    payload: { templateId: tid, fromVersionId: vid },
  });
  return ok(result.version, 201);
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
