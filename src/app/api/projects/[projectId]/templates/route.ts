import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId } from "@/lib/api";
import { withAgentContext, withUserContext, type Db } from "@/db/context";
import { route } from "@/lib/route";
import type { PoolClient } from "pg";

/** 列出项目下全部模板（可按主题过滤），附带所属主题信息。 */
export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  if (requester.kind === "anon") return err(401, "认证失败");
  if (requester.kind === "agent" && requester.key.projectId !== id) {
    return err(403, "API key 无权访问该项目");
  }

  const topicId = parseId(req.nextUrl.searchParams.get("topicId") ?? "");
  const tag = req.nextUrl.searchParams.get("tag")?.trim() || null;
  const q = req.nextUrl.searchParams.get("q")?.trim() || null;
  const status = req.nextUrl.searchParams.get("status")?.trim() || null;

  const listTemplates = async (_db: Db, client: PoolClient) => {
    const res = await client.query(
      `SELECT t.id, t.topic_id AS topic_id, tp.project_id AS project_id,
              tp.name AS topic_name,
              t.name, t.purpose, t.tags, t.status,
              t.created_by::text AS created_by, t.created_at, t.updated_at,
              v.id AS latest_version_id,
              v.status AS latest_status,
              v.created_at AS latest_version_at,
              v.screenshot_path,
              COALESCE(v.lint_report, '[]'::jsonb) AS lint_report
         FROM edm.templates t
         JOIN edm.topics tp ON tp.id = t.topic_id
         LEFT JOIN LATERAL (
           SELECT id, status, created_at, screenshot_path, lint_report
             FROM edm.versions
            WHERE template_id = t.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
         ) v ON true
        WHERE tp.project_id = $1
          AND ($2::bigint IS NULL OR t.topic_id = $2)
          AND ($3::text IS NULL OR t.status = $3)
          AND ($4::text IS NULL OR $4 = ANY(t.tags))
          AND ($5::text IS NULL
               OR t.name ILIKE '%' || $5 || '%'
               OR t.purpose ILIKE '%' || $5 || '%')
        ORDER BY t.updated_at DESC`,
      [id, topicId, status, tag, q],
    );
    return res.rows;
  };

  const templates =
    requester.kind === "user"
      ? await withUserContext(requester.user.id, listTemplates)
      : await withAgentContext(id, listTemplates);

  return ok(templates);
});
