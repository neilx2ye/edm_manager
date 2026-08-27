import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson } from "@/lib/api";
import { withAgentContext, withUserContext } from "@/db/context";
import { servicePool } from "@/db/pools";
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
  const limit = Math.min(
    200,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100) || 100),
  );
  const offset = Math.max(
    0,
    Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0,
  );

  if (requester.kind === "user") {
    const rows = await withUserContext(requester.user.id, async (_db, client) => {
      const res = await client.query(
        `SELECT v.id, v.template_id::bigint, v.html, v.source, v.note, v.status,
                v.lint_report, v.screenshot_path,
                v.created_by::text, v.source_api_key_id::bigint, v.created_at,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', j.id, 'kind', j.kind, 'status', j.status,
                      'result', j.result, 'error', j.error,
                      'startedAt', j.started_at, 'finishedAt', j.finished_at
                    ) ORDER BY j.id
                  ) FILTER (WHERE j.id IS NOT NULL),
                  '[]'::jsonb
                ) AS jobs
           FROM edm.versions v
           LEFT JOIN edm.version_jobs j ON j.version_id = v.id
          WHERE v.template_id = $1
          GROUP BY v.id
          ORDER BY v.created_at DESC, v.id DESC
          LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      return res.rows;
    });
    return ok(rows);
  }

  if (requester.kind === "agent") {
    const project = await templateProject(id);
    if (!project) return err(404, "模板不存在");
    if (project !== requester.key.projectId) return err(403, "API key 无权访问该模板");

    const rows = await withAgentContext(project, async (_db, client) => {
      const res = await client.query(
        `SELECT v.id, v.template_id::bigint, v.html, v.source, v.note, v.status,
                v.lint_report, v.screenshot_path,
                v.created_by::text, v.source_api_key_id::bigint, v.created_at,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', j.id, 'kind', j.kind, 'status', j.status,
                      'result', j.result, 'error', j.error,
                      'startedAt', j.started_at, 'finishedAt', j.finished_at
                    ) ORDER BY j.id
                  ) FILTER (WHERE j.id IS NOT NULL),
                  '[]'::jsonb
                ) AS jobs
           FROM edm.versions v
           LEFT JOIN edm.version_jobs j ON j.version_id = v.id
          WHERE v.template_id = $1
          GROUP BY v.id
          ORDER BY v.created_at DESC, v.id DESC
          LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      return res.rows;
    });
    return ok(rows);
  }

  return err(401, "认证失败");
});

export const POST = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) => {
  const { templateId } = await params;
  const id = parseId(templateId);
  if (!id) return err(400, "无效模板 ID");

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const html = typeof body?.html === "string" ? body.html : "";
  if (!html.trim()) return err(400, "html 不能为空");
  const source = typeof body?.source === "string" ? body.source : null;
  const note = typeof body?.note === "string" ? body.note : null;
  const status = body?.status === "saved" ? "saved" : "draft";

  const requester = await getRequester(req);

  if (requester.kind === "user") {
    const version = await withUserContext(
      requester.user.id,
      async (_db, client) => {
        const res = await client.query(
          `INSERT INTO edm.versions
             (template_id, html, source, note, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, template_id::bigint, status, note, created_at`,
          [id, html, source, note, status, requester.user.id],
        );
        return res.rows[0] ?? null;
      },
    );
    if (!version) return err(403, "无权提交版本（需要 editor 及以上角色）");
    await writeAudit({
      projectId: await templateProject(id),
      actorId: requester.user.id,
      action: "version.created",
      entityType: "version",
      entityId: Number(version.id),
      payload: { templateId: id, status, note },
    });
    return ok(version, 201);
  }

  if (requester.kind === "agent") {
    const project = await templateProject(id);
    if (!project) return err(404, "模板不存在");
    if (project !== requester.key.projectId) {
      return err(403, "API key 与模板项目不匹配");
    }
    if (status === "saved") {
      const canApprove = await servicePool.query(
        "SELECT agent_can_approve FROM edm.projects WHERE id = $1",
        [project],
      );
      if (canApprove.rows[0]?.agent_can_approve !== true) {
        return err(403, "项目已关闭 agent 直接采纳（agent_can_approve）");
      }
    }

    const version = await withAgentContext(project, async (_db, client) => {
      const res = await client.query(
        `INSERT INTO edm.versions
           (template_id, html, source, note, status, source_api_key_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, template_id::bigint, status, note, created_at`,
        [id, html, source, note, status, requester.key.keyId],
      );
      return res.rows[0] ?? null;
    });
    if (!version) return err(403, "提交被拒绝");
    await writeAudit({
      projectId: project,
      actorId: null,
      action: "version.created_by_agent",
      entityType: "version",
      entityId: Number(version.id),
      payload: { templateId: id, status, note, apiKeyId: requester.key.keyId },
    });
    return ok(version, 201);
  }

  return err(401, "认证失败：需要登录会话或 Bearer API key");
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
