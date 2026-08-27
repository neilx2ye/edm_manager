import { NextResponse } from "next/server";
import { err } from "./api";

/**
 * API 路由统一包装：
 * - RLS 拒绝（SQLSTATE 42501）→ 403
 * - 其他异常 → 500（JSON），避免 Next 默认 HTML 错误页
 */
export function route<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (e) {
      const pgErr = e as { code?: string; message?: string };
      if (
        pgErr.code === "42501" ||
        /row-level security/i.test(pgErr.message ?? "")
      ) {
        return err(403, "权限不足：无权执行该操作");
      }
      console.error("[api] 未处理错误:", e);
      return err(500, "服务器内部错误");
    }
  };
}
