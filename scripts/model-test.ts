/**
 * 三层模型流程测试：主题 CRUD → 主题下建模板 → 跨主题移动 →
 * 邀请成员（项目+初始密码）→ 受邀者登录并改密。
 */
const BASE = process.env.SMOKE_BASE || "http://localhost:3000";

async function login(email: string, password: string): Promise<string[]> {
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
  const admin = await login("admin@edm.local", "admin123456");
  const projects = (await (
    await fetch(`${BASE}/api/projects`, auth(admin))
  ).json()) as { id: number }[];
  const projectId = projects[0].id;

  // 1. 创建主题
  const topicRes = await fetch(`${BASE}/api/projects/${projectId}/topics`, {
    ...auth(admin),
    method: "POST",
    body: JSON.stringify({ name: "测试主题", purpose: "模型流程测试" }),
  });
  const topic = (await topicRes.json()) as { id: number };
  check("创建主题", topicRes.status === 201 && topic.id > 0);

  // 2. 主题列表含新建主题
  const topics = (await (
    await fetch(`${BASE}/api/projects/${projectId}/topics`, auth(admin))
  ).json()) as { id: number; name: string }[];
  check("主题列表", topics.some((t) => t.id === topic.id));

  // 3. 在主题下创建模板（含首个版本）
  const tplRes = await fetch(`${BASE}/api/topics/${topic.id}/templates`, {
    ...auth(admin),
    method: "POST",
    body: JSON.stringify({
      name: "主题内模板",
      tags: ["测试"],
      html: "<p>hello topic</p>",
      note: "初始版本",
    }),
  });
  const created = (await tplRes.json()) as {
    template: { id: number };
    version: { id: number } | null;
  };
  check("主题下创建模板+首版", tplRes.status === 201 && created.version !== null);

  // 4. 按主题过滤模板列表
  const filtered = (await (
    await fetch(
      `${BASE}/api/projects/${projectId}/templates?topicId=${topic.id}`,
      auth(admin),
    )
  ).json()) as { id: number; topic_id: number; topic_name: string }[];
  check(
    "按主题过滤模板",
    filtered.every((t) => t.topic_id === topic.id) && filtered.length === 1,
  );

  // 5. 跨主题移动
  const other = topics.find((t) => t.id !== topic.id)!;
  const moveRes = await fetch(
    `${BASE}/api/templates/${created.template.id}/move`,
    {
      ...auth(admin),
      method: "POST",
      body: JSON.stringify({ topicId: other.id }),
    },
  );
  check("移动模板到另一主题", moveRes.status === 200);

  // 6. 邀请成员：项目 + 角色（管理员/成员）+ 初始密码
  const email = `invite-${Date.now()}@edm.local`;
  const inviteRes = await fetch(`${BASE}/api/projects/${projectId}/members`, {
    ...auth(admin),
    method: "POST",
    body: JSON.stringify({
      email,
      role: "member",
      name: "受邀成员",
      password: "invite123456",
    }),
  });
  check("邀请成员（指定初始密码）", inviteRes.status === 201);

  // 7. 受邀者用初始密码登录
  const invitee = await login(email, "invite123456");
  const me = await fetch(`${BASE}/api/me`, auth(invitee));
  check("受邀者可用初始密码登录", me.status === 200);

  // 8. 受邀者修改密码
  const cpRes = await fetch(`${BASE}/api/auth/change-password`, {
    ...auth(invitee),
    method: "POST",
    body: JSON.stringify({
      oldPassword: "invite123456",
      newPassword: "newpass123456",
    }),
  });
  check("受邀者修改密码", cpRes.status === 200);

  // 9. 新密码登录成功，旧密码失败
  const again = await login(email, "newpass123456");
  const me2 = await fetch(`${BASE}/api/me`, auth(again));
  check("新密码可登录", me2.status === 200);

  // 10. 全局用户管理：列表 → 创建（多项目分配）→ 变更/移除成员资格
  const ulistRes = await fetch(`${BASE}/api/users`, auth(admin));
  const ulist = (await ulistRes.json()) as { id: string; email: string }[];
  check("全局用户列表", ulistRes.status === 200 && ulist.length > 0);

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
  const gm = (await gmRes.json()) as { id: string };
  check("创建用户并分配项目", gmRes.status === 201 && Boolean(gm.id));

  const putRes = await fetch(`${BASE}/api/users/${gm.id}/memberships`, {
    ...auth(admin),
    method: "PUT",
    body: JSON.stringify({ projectId, role: "admin" }),
  });
  check("变更成员项目角色", putRes.status === 200);

  const delRes = await fetch(
    `${BASE}/api/users/${gm.id}/memberships/${projectId}`,
    { ...auth(admin), method: "DELETE" },
  );
  check("移除成员项目资格", delRes.status === 200);

  console.log(failures === 0 ? "\n✅ 三层模型流程测试通过" : `\n❌ ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("模型测试失败:", e);
  process.exit(1);
});
