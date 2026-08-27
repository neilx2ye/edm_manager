/**
 * 端到端冒烟测试：登录 → 项目/模板读取 → 创建 API key → agent 推送版本
 * 运行：npx tsx --env-file=.env scripts/smoke.ts
 */
export {};

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";

interface CookieJar {
  cookies: string[];
}

function getCookieValue(jar: CookieJar, name: string): string | undefined {
  for (const c of jar.cookies) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (pair.slice(0, idx).trim() === name) return pair.slice(idx + 1);
  }
  return undefined;
}

async function main() {
  const jar: CookieJar = { cookies: [] };

  // 1. CSRF
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const setCookies = csrfRes.headers.getSetCookie();
  jar.cookies.push(...setCookies);
  const csrf = (await csrfRes.json()) as { csrfToken: string };

  // 2. 登录
  const form = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email: "admin@edm.local",
    password: "admin123456",
    callbackUrl: `${BASE}/`,
  });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
      Cookie: jar.cookies.join("; "),
    },
    body: form.toString(),
    redirect: "manual",
  });
  jar.cookies.push(...loginRes.headers.getSetCookie());
  const loginBody = await loginRes.text();
  const sessionToken =
    getCookieValue(jar, "authjs.session-token") ??
    getCookieValue(jar, "__Secure-authjs.session-token");
  if (loginRes.status !== 200 || !sessionToken) {
    console.log("登录 set-cookie:", JSON.stringify(loginRes.headers.getSetCookie()));
    console.log("登录 body:", loginBody);
  }
  console.log("登录:", loginRes.status, "session:", sessionToken ? "OK" : "缺失");
  if (!sessionToken) process.exit(1);

  const authed = (path: string, init?: RequestInit) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Cookie: jar.cookies.join("; "),
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string>),
      },
    });

  // 3. me / projects / topics
  const me = await (await authed("/api/me")).json();
  console.log("me:", JSON.stringify(me));

  const projects = (await (
    await authed("/api/projects")
  ).json()) as { id: number; name: string; myRole: string }[];
  console.log("projects:", projects.map((p) => `${p.name}(${p.myRole})`));
  const projectId = projects[0].id;

  const topics = (await (
    await authed(`/api/projects/${projectId}/topics`)
  ).json()) as { id: number; name: string; templateCount: number }[];
  console.log("topics:", topics.map((t) => `${t.name}(${t.templateCount})`));

  const templates = (await (
    await authed(`/api/projects/${projectId}/templates`)
  ).json()) as { id: number; name: string; latestVersionId: string }[];
  console.log("templates:", templates.map((t) => t.name));
  const templateId = templates[0].id;

  // 4. 创建 API key（明文只返回一次）
  const keyRes = await authed(`/api/projects/${projectId}/api-keys`, {
    method: "POST",
    body: JSON.stringify({ name: "smoke-test-key" }),
  });
  const key = (await keyRes.json()) as { key: string; id: number };
  console.log("api key 创建:", keyRes.status, "id=", key.id);
  if (!key.key) process.exit(1);

  // 5. agent 推送版本
  const pushRes = await fetch(`${BASE}/api/templates/${templateId}/versions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      html: "<html><body><h1>Smoke 测试版本</h1></body></html>",
      note: "来自冒烟测试",
      status: "draft",
    }),
  });
  const pushed = (await pushRes.json()) as { id: number; status: string };
  console.log("agent 推送:", pushRes.status, JSON.stringify(pushed));

  // 6. agent 读取历史（含任务状态）
  const history = (await (
    await fetch(`${BASE}/api/templates/${templateId}/versions?limit=5`, {
      headers: { Authorization: `Bearer ${key.key}` },
    })
  ).json()) as { id: number; jobs: unknown[] }[];
  console.log(
    "agent 读取历史:",
    history.map((v) => `#${v.id} jobs=${v.jobs.length}`),
  );

  console.log("\n✅ 冒烟测试全部通过");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ 冒烟测试失败:", e);
  process.exit(1);
});
