import type { PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { appPool, servicePool } from "./pools";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * 在事务中注入当前登录用户身份，并执行业务逻辑。
 * RLS 只信任 edm.current_user_id 这个会话变量。
 */
export async function withUserContext<T>(
  userId: string,
  fn: (db: Db, client: PoolClient) => Promise<T>,
): Promise<T> {
  return withContext(
    {
      "edm.current_user_id": userId,
    },
    fn,
  );
}

/**
 * 注入 agent（API key）上下文。调用方必须先以 edm_service 校验 key。
 */
export async function withAgentContext<T>(
  projectId: number,
  fn: (db: Db, client: PoolClient) => Promise<T>,
  options?: { keyId?: number },
): Promise<T> {
  return withContext(
    {
      "edm.api_key_project_id": String(projectId),
      "edm.api_key_valid": "true",
      ...(options?.keyId ? { "edm.api_key_id": String(options.keyId) } : {}),
    },
    fn,
  );
}

async function withContext<T>(
  settings: Record<string, string>,
  fn: (db: Db, client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of Object.entries(settings)) {
      await client.query("SELECT set_config($1, $2, true)", [key, value]);
    }
    const db = drizzle(client, { schema });
    const result = await fn(db, client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // 事务可能已失败，忽略回滚错误
    }
    throw err;
  } finally {
    client.release();
  }
}

/** 供 WS 网关等按需复核成员资格：返回该用户在项目中的最高有效角色（无则 null）。 */
export async function checkMembership(
  userId: string,
  projectId: number,
): Promise<boolean> {
  const res = await servicePool.query(
    "SELECT edm.is_member_for($1::uuid, $2::bigint) AS ok",
    [userId, projectId],
  );
  return res.rows[0]?.ok === true;
}

/** 指定用户是否为系统管理员（用户管理的准入条件）。 */
export async function isGlobalAdmin(userId: string): Promise<boolean> {
  const res = await servicePool.query(
    "SELECT edm.is_admin_for($1::uuid) AS ok",
    [userId],
  );
  return res.rows[0]?.ok === true;
}
