import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId } from "@/lib/api";
import { withAgentContext, withUserContext } from "@/db/context";
import { servicePool } from "@/db/pools";
import { route } from "@/lib/route";

export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) => {
  const { versionId } = await params;
  const id = parseId(versionId);
  if (!id) return err(400, "无效版本 ID");

  const requester = await getRequester(req);
  const project = await versionProject(id);
  if (!project) return err(404, "版本不存在");

  const fetchRow = async (client: {
    query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
  }) => {
    const res = await client.query(
      `SELECT v.id, v.template_id::bigint, v.html, v.source, v.note, v.status,
              v.lint_report, v.screenshot_path,
              v.created_by::text, v.source_api_key_id::bigint, v.created_at,
              t.name AS template_name, t.topic_id AS topic_id,
              tp.project_id AS project_id
         FROM edm.versions v
         JOIN edm.templates t ON t.id = v.template_id
         JOIN edm.topics tp ON tp.id = t.topic_id
        WHERE v.id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  };

  if (requester.kind === "user") {
    const row = await withUserContext(requester.user.id, async (_db, client) =>
      fetchRow(client),
    );
    if (!row) return err(404, "版本不存在或无权访问");
    return ok(row);
  }

  if (requester.kind === "agent") {
    if (project !== requester.key.projectId) {
      return err(403, "API key 与版本项目不匹配");
    }
    const row = await withAgentContext(project, async (_db, client) =>
      fetchRow(client),
    );
    if (!row) return err(404, "版本不存在");
    return ok(row);
  }

  return err(401, "认证失败");
});

async function versionProject(versionId: number): Promise<number | null> {
  const res = await servicePool.query(
    `SELECT tp.project_id AS project_id
       FROM edm.versions v
       JOIN edm.templates t ON t.id = v.template_id
       JOIN edm.topics tp ON tp.id = t.topic_id
      WHERE v.id = $1`,
    [versionId],
  );
  return res.rowCount === 1 ? Number(res.rows[0].project_id) : null;
}
