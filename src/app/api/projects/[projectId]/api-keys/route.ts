import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId, readJson, requireUser } from "@/lib/api";
import { withUserContext } from "@/db/context";
import { generateApiKey, hashApiKey } from "@/lib/api-keys";
import { writeAudit } from "@/lib/audit";
import { route } from "@/lib/route";

export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const keys = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `SELECT id, name, role, created_by::text, last_used_at, revoked_at, created_at
         FROM edm.project_api_keys
        WHERE project_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [id],
    );
    return res.rows;
  });
  return ok(keys);
});

export const POST = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return err(400, "API key 名称不能为空");

  const plaintext = generateApiKey();
  const created = await withUserContext(userOrErr.id, async (_db, client) => {
    const res = await client.query(
      `INSERT INTO edm.project_api_keys (project_id, name, key_hash, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, created_at`,
      [id, name, hashApiKey(plaintext), userOrErr.id],
    );
    return res.rows[0];
  });

  await writeAudit({
    projectId: id,
    actorId: userOrErr.id,
    action: "project.api_key_created",
    entityType: "api_key",
    entityId: Number(created.id),
    payload: { name },
  });
  // 明文仅在创建时展示一次
  return ok({ ...created, key: plaintext }, 201);
});
