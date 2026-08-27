/**
 * 权限与流程测试：agent_can_approve 开关、agent 采纳、用户回滚。
 * 运行：npx tsx --env-file=.env scripts/flow-test.ts
 */
export {};

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";

async function login() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const cookies = [...csrfRes.headers.getSetCookie()];
  const csrf = (await csrfRes.json()) as { csrfToken: string };
  const form = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email: "admin@edm.local",
    password: "admin123456",
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

function auth(cookies: string[], extra?: Record<string, string>) {
  return {
    headers: { Cookie: cookies.join("; "), ...extra },
  };
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  const cookies = await login();
  const projects = (await (
    await fetch(`${BASE}/api/projects`, auth(cookies))
  ).json()) as { id: number; agentCanApprove: boolean }[];
  const projectId = projects[0].id;

  const key = (
    (await (
      await fetch(`${BASE}/api/projects/${projectId}/api-keys`, {
        ...auth(cookies),
        method: "POST",
        body: JSON.stringify({ name: "flow-test-key" }),
      })
    ).json()) as { key: string }
  ).key;

  const templates = (await (
    await fetch(`${BASE}/api/projects/${projectId}/templates`, auth(cookies))
  ).json()) as { id: number }[];
  const templateId = templates[0].id;

  const agentHeaders = { Authorization: `Bearer ${key}` };

  // 1. 关闭 agent 直接采纳
  const offRes = await fetch(`${BASE}/api/projects/${projectId}`, {
    ...auth(cookies),
    method: "PATCH",
    body: JSON.stringify({ agentCanApprove: false }),
  });
  check("关闭 agentCanApprove", offRes.ok);

  // 2. agent 直接提交 saved → 应被拒
  const savedPush = await fetch(`${BASE}/api/templates/${templateId}/versions`, {
    method: "POST",
    headers: { ...agentHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ html: "<p>saved attempt</p>", status: "saved" }),
  });
  check("agent 提交 saved 被拒（开关关闭）", savedPush.status === 403);

  // 3. agent 提交 draft → 应成功
  const draftPush = await fetch(
    `${BASE}/api/templates/${templateId}/versions`,
    {
      method: "POST",
      headers: { ...agentHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<p>draft ok</p>", note: "flow-test" }),
    },
  );
  const draft = (await draftPush.json()) as { id: number };
  check("agent 提交 draft 成功", draftPush.status === 201);

  // 4. agent 采纳 draft → 开关关闭应被拒
  const approveOff = await fetch(
    `${BASE}/api/templates/${templateId}/versions/${draft.id}/approve`,
    { method: "POST", headers: agentHeaders },
  );
  check("agent 采纳被拒（开关关闭）", approveOff.status === 403);

  // 5. 打开开关后 agent 采纳 → 成功
  await fetch(`${BASE}/api/projects/${projectId}`, {
    ...auth(cookies),
    method: "PATCH",
    body: JSON.stringify({ agentCanApprove: true }),
  });
  const approveOn = await fetch(
    `${BASE}/api/templates/${templateId}/versions/${draft.id}/approve`,
    { method: "POST", headers: agentHeaders },
  );
  check("agent 采纳成功（开关开启）", approveOn.status === 200);

  // 6. 用户回滚历史版本（saved 版本）→ 生成新版本
  const rollbackRes = await fetch(
    `${BASE}/api/templates/${templateId}/versions/${draft.id}/rollback`,
    { method: "POST", ...auth(cookies) },
  );
  const rolled = (await rollbackRes.json()) as { id: number; status: string };
  check(
    "用户回滚生成新版本",
    rollbackRes.status === 201 && rolled.status === "saved",
  );

  // 7. 权限由 RLS 兜底（两级角色：member 可编辑、admin 管成员）；此处验证 API 拒绝匿名
  const anonPush = await fetch(
    `${BASE}/api/templates/${templateId}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<p>anon</p>" }),
    },
  );
  check("匿名提交被拒", anonPush.status === 401);

  console.log(failures === 0 ? "\n✅ 流程测试全部通过" : `\n❌ ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("流程测试失败:", e);
  process.exit(1);
});
