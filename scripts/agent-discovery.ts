/**
 * Agent 只读发现冒烟测试：登录 → 取项目 → 创建 API key →
 * 用 key 列出主题/模板 → 越权项目应 403 → 撤销 key。
 * 运行：npx tsx --env-file=.env scripts/agent-discovery.ts
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

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.cookies.push(...csrfRes.headers.getSetCookie());
  const csrf = (await csrfRes.json()) as { csrfToken: string };

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
      Cookie: jar.cookies.join("; "),
    },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: "admin@edm.local",
      password: "admin123456",
      callbackUrl: `${BASE}/`,
    }).toString(),
    redirect: "manual",
  });
  jar.cookies.push(...loginRes.headers.getSetCookie());
  const sessionToken =
    getCookieValue(jar, "authjs.session-token") ??
    getCookieValue(jar, "__Secure-authjs.session-token");
  if (loginRes.status !== 200 || !sessionToken) {
    console.error("登录失败:", loginRes.status);
    process.exit(1);
  }

  const authed = (path: string, init?: RequestInit) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Cookie: jar.cookies.join("; "),
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string>),
      },
    });

  const projects = (await (
    await authed("/api/projects")
  ).json()) as { id: number; name: string }[];
  const projectId = projects[0].id;

  const keyRes = await authed(`/api/projects/${projectId}/api-keys`, {
    method: "POST",
    body: JSON.stringify({ name: "agent-discovery-test" }),
  });
  const key = (await keyRes.json()) as { key: string; id: number };
  if (!key.key) {
    console.error("API key 创建失败:", keyRes.status);
    process.exit(1);
  }

  const agentHeaders = {
    Authorization: `Bearer ${key.key}`,
    "Content-Type": "application/json",
  };

  const topicsRes = await fetch(`${BASE}/api/projects/${projectId}/topics`, {
    headers: agentHeaders,
  });
  const topics = (await topicsRes.json()) as {
    id: number;
    name: string;
    template_count: number;
  }[];
  console.log(
    "agent 列主题:",
    topicsRes.status,
    topics.map((t) => `${t.name}(${t.template_count})`).join(", "),
  );
  if (topicsRes.status !== 200 || !Array.isArray(topics)) process.exit(1);

  const templatesRes = await fetch(
    `${BASE}/api/projects/${projectId}/templates`,
    { headers: agentHeaders },
  );
  const templates = (await templatesRes.json()) as { id: number; name: string }[];
  console.log(
    "agent 列模板:",
    templatesRes.status,
    templates.map((t) => t.name).join(", "),
  );
  if (templatesRes.status !== 200 || !Array.isArray(templates)) process.exit(1);

  const crossRes = await fetch(`${BASE}/api/projects/${projectId + 999}/topics`, {
    headers: agentHeaders,
  });
  console.log("越权项目:", crossRes.status);
  if (crossRes.status !== 403) process.exit(1);

  await authed(`/api/projects/${projectId}/api-keys/${key.id}`, {
    method: "DELETE",
  });

  console.log("\n✅ agent 只读发现测试通过");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ agent 只读发现测试失败:", e);
  process.exit(1);
});
