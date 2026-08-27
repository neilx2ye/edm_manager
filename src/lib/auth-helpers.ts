import { auth } from "@/auth/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
}

/** 服务端获取当前会话用户；未登录返回 null。 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return {
    id: user.id,
    email: user.email ?? "",
    name: user.name ?? "",
    mustChangePassword: Boolean(
      (user as unknown as Record<string, unknown>).mustChangePassword,
    ),
  };
}

/** 校验会话 cookie（供 WS 网关使用，无 Next 请求上下文）。
 *  JWT 会话策略下，cookie 为加密 JWT，用 AUTH_SECRET 解密后取 sub（用户 id）。
 */
export async function resolveSessionToken(
  token: string,
  cookieName = "authjs.session-token",
): Promise<{ userId: string } | null> {
  if (!process.env.AUTH_SECRET) return null;
  const { decode } = await import("next-auth/jwt");
  const salt =
    cookieName === "__Secure-authjs.session-token"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";
  const payload = await decode({
    token,
    secret: process.env.AUTH_SECRET,
    salt,
  });
  if (!payload?.sub) return null;
  return { userId: String(payload.sub) };
}
