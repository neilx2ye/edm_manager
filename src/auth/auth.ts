import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import { appPool } from "@/db/pools";
import { authSchema } from "@/db/schema";
import { servicePool } from "@/db/pools";
import { verifyPassword } from "@/lib/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // authSchema 与 adapter 期望的列名/类型一致（users/sessions/accounts/verification_tokens），
  // 额外列（password_hash 等）不影响 adapter 行为。
  adapter: DrizzleAdapter(drizzle(appPool), authSchema as never),
  // Credentials provider 在 Auth.js v5 仅支持 JWT 会话策略；会话仍为 httpOnly cookie。
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "邮箱 + 密码",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // 凭据哈希只通过服务端角色读取（edm_app 无 password_hash 列权限）
        const res = await servicePool.query(
          `SELECT id, email::text, name, password_hash, must_change_password, role
             FROM auth.users
            WHERE email = $1`,
          [email],
        );
        const row = res.rows[0];
        if (!row?.password_hash) return null;
        const ok = await verifyPassword(row.password_hash, password);
        if (!ok) return null;

        return {
          id: String(row.id),
          email: row.email,
          name: row.name ?? row.email,
          mustChangePassword: row.must_change_password === true,
          role: row.role === "admin" ? "admin" : "member",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = (user as { id?: string }).id;
        token.mustChangePassword = Boolean(
          (user as unknown as { mustChangePassword?: boolean }).mustChangePassword,
        );
        token.role = (user as { role?: string }).role ?? "member";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.email = session.user.email ?? (token.email as string) ?? "";
        (session.user as unknown as Record<string, unknown>).mustChangePassword =
          Boolean(token.mustChangePassword);
        (session.user as unknown as Record<string, unknown>).role =
          token.role ?? "member";
      }
      return session;
    },
  },
});
