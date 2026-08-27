import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; keyId: string }> },
) => {
  const { projectId, keyId } = await params;
  const id = parseId(projectId);
  const kid = parseId(keyId);
  if (!id || !kid) return err(400, "参数无效");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const revoked = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `UPDATE edm.project_api_keys
          SET revoked_at = now()
        WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL
        RETURNING id, name`,
      [kid, id],
    );
    return res.rows[0] ?? null;
  });
  if (!revoked) return err(404, "API key 不存在或无权操作");

  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "project.api_key_revoked",
    entityType: "api_key",
    entityId: kid,
    payload: { name: revoked.name },
  });
  return ok({ ok: true });
});
