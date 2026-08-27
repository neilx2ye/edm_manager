import { NextRequest } from "next/server";
import { err, getRequester, ok, readJson } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/password";
import { servicePool } from "@/db/pools";
import { route } from "@/lib/route";

export const POST = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  if (requester.kind !== "user") return err(401, "请先登录");

  const body = (await readJson(req)) as {
    oldPassword?: unknown;
    newPassword?: unknown;
  } | null;
  const oldPassword = typeof body?.oldPassword === "string" ? body.oldPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8) return err(400, "新密码至少 8 位");

  const row = await servicePool.query(
    "SELECT password_hash FROM auth.users WHERE id = $1",
    [requester.user.id],
  );
  const currentHash = row.rows[0]?.password_hash;
  if (!currentHash) return err(400, "账号异常");
  if (!(await verifyPassword(currentHash, oldPassword))) {
    return err(400, "原密码不正确");
  }

  await servicePool.query(
    `UPDATE auth.users
        SET password_hash = $2, must_change_password = false, "updatedAt" = now()
      WHERE id = $1`,
    [requester.user.id, await hashPassword(newPassword)],
  );
  return ok({ ok: true });
});
