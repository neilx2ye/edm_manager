import { NextRequest } from "next/server";
import { err, getRequester, parseId } from "@/lib/api";
import { readScreenshot } from "@/lib/storage";
import { servicePool } from "@/db/pools";
import { route } from "@/lib/route";

export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ versionId: string; kind: string }> },
) => {
  const { versionId, kind } = await params;
  const id = parseId(versionId);
  if (!id) return err(400, "无效版本 ID");
  if (kind !== "desktop" && kind !== "mobile") return err(400, "无效截图类型");

  const requester = await getRequester(req);
  if (requester.kind === "anon") return err(401, "认证失败");

  const project = await versionProject(id);
  if (!project) return err(404, "版本不存在");
  if (requester.kind === "agent" && requester.key.projectId !== project) {
    return err(403, "无权访问");
  }
  if (requester.kind === "user") {
    const { checkMembership } = await import("@/db/context");
    const okMember = await checkMembership(requester.user.id, project, "viewer");
    if (!okMember) return err(403, "无权访问");
  }

  const buf = await readScreenshot(id, kind);
  if (!buf) return err(404, "截图尚未生成");
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
    },
  });
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
