import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, type ValidApiKey } from "./api-keys";
import { getSessionUser, type SessionUser } from "./auth-helpers";

export type Requester =
  | { kind: "user"; user: SessionUser }
  | { kind: "agent"; key: ValidApiKey }
  | { kind: "anon" };

/** 解析请求方身份：会话 cookie 或 Bearer API key。 */
export async function getRequester(req: NextRequest): Promise<Requester> {
  const bearer = req.headers.get("authorization");
  if (bearer) {
    const key = await validateApiKey(bearer);
    if (key) return { kind: "agent", key };
    return { kind: "anon" };
  }
  const user = await getSessionUser();
  if (user) return { kind: "user", user };
  return { kind: "anon" };
}

export function err(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** 要求登录用户。 */
export function requireUser(
  requester: Requester,
): SessionUser | NextResponse {
  if (requester.kind !== "user") {
    return err(401, "请先登录");
  }
  return requester.user;
}

/** 要求登录用户或有效 agent。 */
export function requireActor(
  requester: Requester,
): { kind: "user"; user: SessionUser } | { kind: "agent"; key: ValidApiKey } | NextResponse {
  if (requester.kind === "anon") {
    return err(401, "认证失败：无效的会话或 API key");
  }
  return requester as { kind: "user"; user: SessionUser };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
