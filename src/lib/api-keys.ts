import { createHash, randomBytes } from "node:crypto";
import { servicePool } from "@/db/pools";

const KEY_PREFIX = "edm_";

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface ValidApiKey {
  keyId: number;
  projectId: number;
}

/**
 * 校验 agent 携带的 Bearer key。仅服务端角色（BYPASSRLS）读取 key_hash。
 * 校验通过后由 RLS 在写路径二次兜底。
 */
export async function validateApiKey(
  bearer: string | null,
): Promise<ValidApiKey | null> {
  if (!bearer) return null;
  const key = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!key || !key.startsWith(KEY_PREFIX)) return null;

  const res = await servicePool.query(
    `UPDATE edm.project_api_keys
        SET last_used_at = now()
      WHERE key_hash = $1
        AND revoked_at IS NULL
      RETURNING id, project_id`,
    [hashApiKey(key)],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { keyId: Number(row.id), projectId: Number(row.project_id) };
}
