/**
 * 角色矩阵测试（两级角色）：
 *  - member（非管理员）可查看与编辑，不能管理成员 / API key，不能访问全局用户管理
 *  - admin（管理员）可邀请新用户、分配项目
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

  // 管理员邀请新用户（预建 member 账号）
  const addRes = await fetch(`${BASE}/api/projects/${projectId}/members`, {
    ...auth(admin),
    method: "POST",
    body: JSON.stringify({
      email: "member@edm.local",
      role: "member",
      name: "普通成员",
      password: "member123456",
    }),
  });
  if (addRes.status !== 200 && addRes.status !== 201) {
    console.error("邀请 member 失败:", addRes.status, await addRes.text());
    process.exit(1);
  }
  // 统一把密码重置为已知值，保证测试可重复（新建与已存在账号均适用）
  {
    const { servicePool } = await import("../src/db/pools");
    const { hashPassword } = await import("../src/lib/password");
    await servicePool.query(
      "UPDATE auth.users SET password_hash=$1, must_change_password=false WHERE email='member@edm.local'",
      [await hashPassword("member123456")],
    );
    await servicePool.end();
  }
  const member = await loginAs("member@edm.local", "member123456");

  // member 可见模板列表
  const listRes = await fetch(
    `${BASE}/api/projects/${projectId}/templates`,
    auth(member),
  );
  check("member 可查看模板列表", listRes.ok);

  // member 可提交版本（编辑权限）
  const pushRes = await fetch(`${BASE}/api/templates/${templateId}/versions`, {
    ...auth(member),
    method: "POST",
    body: JSON.stringify({ html: "<p>member push</p>" }),
  });
  check(
    "member 可提交版本（编辑权限）",
    pushRes.status === 200 || pushRes.status === 201,
  );

  // member 不能添加成员
  const mgrRes = await fetch(`${BASE}/api/projects/${projectId}/members`, {
    ...auth(member),
    method: "POST",
    body: JSON.stringify({ email: "x@edm.local", role: "member" }),
  });
  check("member 不能添加成员", mgrRes.status === 403);

  // member 不能访问全局用户管理
  const ulistRes = await fetch(`${BASE}/api/users`, auth(member));
  check("member 不能访问用户管理", ulistRes.status === 403);

  // member 不能管理 API key
  const keyRes = await fetch(`${BASE}/api/projects/${projectId}/api-keys`, {
    ...auth(member),
    method: "POST",
    body: JSON.stringify({ name: "forbidden" }),
  });
  check("member 不能管理 API key", keyRes.status === 403);

  // admin 可通过全局用户管理邀请用户并分配项目
  const gmEmail = `gm-${Date.now()}@edm.local`;
  const gmRes = await fetch(`${BASE}/api/users`, {
    ...auth(admin),
    method: "POST",
    body: JSON.stringify({
      email: gmEmail,
      name: "全局成员",
      password: "global123",
      assignments: [{ projectId, role: "member" }],
    }),
  });
  check("admin 可邀请用户并分配项目", gmRes.status === 201);

  console.log(
    failures === 0 ? "\n✅ 角色矩阵测试通过" : `\n❌ ${failures} 项失败`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("权限测试失败:", e);
  process.exit(1);
});
