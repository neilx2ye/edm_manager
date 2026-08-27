/**
 * 角色矩阵测试：viewer 只读、editor 可提交、admin 管成员（用户路径）。
 */
export {};

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";

async function loginAs(email: string, password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const cookies = [...csrfRes.headers.getSetCookie()];
  const csrf = (await csrfRes.json()) as { csrfToken: string };
  const form = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email,
    password,
    callbackUrl: `${BASE}/`,
  });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
      Cookie: cookies.join("; "),
    },
    body: form.toString(),
    redirect: "manual",
  });
  cookies.push(...res.headers.getSetCookie());
  return cookies;
}

const auth = (cookies: string[]) => ({ headers: { Cookie: cookies.join("; ") } });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const admin = await loginAs("admin@edm.local", "admin123456");
  const projects = (await (
    await fetch(`${BASE}/api/projects`, auth(admin))
  ).json()) as { id: number }[];
  const projectId = projects[0].id;
  const templates = (await (
    await fetch(`${BASE}/api/projects/${projectId}/templates`, auth(admin))
  ).json()) as { id: number }[];
  const templateId = templates[0].id;

  // 预建 viewer 账号
  const addRes = await fetch(`${BASE}/api/projects/${projectId}/members`, {
    ...auth(admin),
    method: "POST",
    body: JSON.stringify({
      email: "viewer@edm.local",
      role: "viewer",
      name: "只读同事",
      password: "viewer123456",
    }),
  });
  if (addRes.status !== 200 && addRes.status !== 201) {
    console.error("添加 viewer 失败:", addRes.status, await addRes.text());
    process.exit(1);
  }
  // 统一把密码重置为已知值，保证测试可重复（新建与已存在账号均适用）
  {
    const { servicePool } = await import("../src/db/pools");
    const { hashPassword } = await import("../src/lib/password");
    await servicePool.query(
      "UPDATE auth.users SET password_hash=$1, must_change_password=false WHERE email='viewer@edm.local'",
      [await hashPassword("viewer123456")],
    );
    await servicePool.end();
  }
  const viewer = await loginAs("viewer@edm.local", "viewer123456");

  // viewer 可见模板列表
  const listRes = await fetch(
    `${BASE}/api/projects/${projectId}/templates`,
    auth(viewer),
  );
  check("viewer 可查看模板列表", listRes.ok);

  // viewer 不能提交版本
  const pushRes = await fetch(`${BASE}/api/templates/${templateId}/versions`, {
    ...auth(viewer),
    method: "POST",
    body: JSON.stringify({ html: "<p>viewer push</p>" }),
  });
  check("viewer 不能提交版本", pushRes.status === 403);

  // viewer 不能管理成员
  const mgrRes = await fetch(`${BASE}/api/projects/${projectId}/members`, {
    ...auth(viewer),
    method: "POST",
    body: JSON.stringify({ email: "x@edm.local", role: "editor" }),
  });
  check("viewer 不能添加成员", mgrRes.status === 403);

  // viewer 不能管理 API key
  const keyRes = await fetch(`${BASE}/api/projects/${projectId}/api-keys`, {
    ...auth(viewer),
    method: "POST",
    body: JSON.stringify({ name: "forbidden" }),
  });
  check("viewer 不能管理 API key", keyRes.status === 403);

  console.log(
    failures === 0 ? "\n✅ 角色矩阵测试通过" : `\n❌ ${failures} 项失败`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("权限测试失败:", e);
  process.exit(1);
});
