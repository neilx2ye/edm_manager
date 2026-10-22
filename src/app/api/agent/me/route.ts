import { NextRequest } from "next/server";
import { err, getRequester, ok } from "@/lib/api";
import { servicePool } from "@/db/pools";
import { route } from "@/lib/route";

/**
 * API key 自省：返回该 key 所属项目。
 *
 * 供 MCP（尤其是 stdio 模式）在未显式配置 projectId 时自动发现项目，
 * 也便于 agent 在调用项目级接口前确认自己的作用域。
 */
export const GET = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  if (requester.kind === "anon") return err(401, "认证失败：无效的 API key");
  if (requester.kind === "user") {
    return err(403, "该接口仅限 API key 调用");
  }

  const res = await servicePool.query(
    `SELECT k.id, k.name, k.project_id, p.name AS project_name
       FROM edm.project_api_keys k
       JOIN edm.projects p ON p.id = k.project_id
      WHERE k.id = $1 AND k.revoked_at IS NULL`,
    [requester.key.keyId],
  );
  const row = res.rows[0];
  if (!row) return err(401, "API key 已失效");

  return ok({
    keyId: Number(row.id),
    keyName: String(row.name),
    projectId: Number(row.project_id),
    projectName: String(row.project_name),
  });
});
