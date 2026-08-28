import { servicePool } from "@/db/pools";
import { hashPassword } from "@/lib/password";
import type { PoolClient } from "pg";

export interface ProvisionedAccount {
  userId: string;
  email: string;
  existed: boolean;
}

/**
 * 邀请制账号供给：邮箱不存在则预建账号（返回一次性初始密码），否则复用。
 */
export async function provisionAccount(
  client: PoolClient,
  email: string,
  name?: string | null,
  initialPassword?: string,
  role: "admin" | "member" = "member",
): Promise<ProvisionedAccount> {
  const existing = await client.query(
    "SELECT id::text FROM auth.users WHERE email = $1",
    [email],
  );
  if (existing.rowCount === 1) {
    return { userId: existing.rows[0].id, email, existed: true };
  }

  if (!initialPassword || initialPassword.length < 8) {
    throw new Error("初始密码至少 8 位");
  }
  const password = initialPassword;
  const hash = await hashPassword(password);
  const created = await client.query(
    `INSERT INTO auth.users (name, email, password_hash, must_change_password, role)
     VALUES ($1, $2, $3, true, $4)
     RETURNING id::text`,
    [name || email.split("@")[0] || email, email, hash, role],
  );
  return {
    userId: created.rows[0].id,
    email,
    existed: false,
  };
}

export async function findUserByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const res = await servicePool.query(
    "SELECT id::text FROM auth.users WHERE email = $1",
    [email],
  );
  return res.rowCount === 1 ? { id: res.rows[0].id } : null;
}
