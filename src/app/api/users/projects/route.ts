import { NextRequest } from "next/server";
import { err, getRequester, ok, requireUser } from "@/lib/api";
import { isGlobalAdmin } from "@/db/context";
import { servicePool } from "@/db/pools";
import { route } from "@/lib/route";

/** 系统管理员用于「分配项目」的全量项目列表。 */
export const GET = route(async (req: NextRequest) => {
  const requester = await getRequester(req);
  const userOrErr = requireUser(requester);
  if ("status" in userOrErr) return userOrErr;
  if (!(await isGlobalAdmin(userOrErr.id))) {
    return err(403, "仅系统管理员可管理用户");
  }

  const res = await servicePool.query(
    "SELECT id, name FROM edm.projects ORDER BY name ASC",
  );
  return ok(res.rows);
});
