import { err, ok } from "@/lib/api";
import { getSessionUser } from "@/lib/auth-helpers";
import { route } from "@/lib/route";

export const GET = route(async () => {
  const user = await getSessionUser();
  if (!user) return err(401, "未登录");
  return ok(user);
});
