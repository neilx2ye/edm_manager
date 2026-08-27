/**
 * 实时链路测试：登录 → 建立 WS 订阅 → agent 推送版本 → 验证收到 version/job 事件。
 * 运行：npx tsx --env-file=.env scripts/ws-smoke.ts
 */
import WebSocket from "ws";

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";
const WS_URL = process.env.SMOKE_WS_URL || "ws://localhost:3001";

async function login(): Promise<string[]> {
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

function cookieHeader(cookies: string[], names: string[]): string {
  const out: string[] = [];
  for (const c of cookies) {
    const [pair] = c.split(";");
    const [k, ...rest] = pair.split("=");
    if (names.includes(k.trim())) out.push(`${k.trim()}=${rest.join("=")}`);
  }
  return out.join("; ");
}

async function main() {
  const cookies = await login();
  const sessionCookie = cookieHeader(cookies, [
    "authjs.session-token",
    "__Secure-authjs.session-token",
  ]);
  if (!sessionCookie) throw new Error("登录失败：无 session cookie");

  const projects = (await (
    await fetch(`${BASE}/api/projects`, {
      headers: { Cookie: cookies.join("; ") },
    })
  ).json()) as { id: number }[];
  const projectId = projects[0].id;

  const keyRes = await fetch(`${BASE}/api/projects/${projectId}/api-keys`, {
    method: "POST",
    headers: { Cookie: cookies.join("; "), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "ws-smoke-key" }),
  });
  const key = (await keyRes.json()) as { key: string };

  const templates = (await (
    await fetch(`${BASE}/api/projects/${projectId}/templates`, {
      headers: { Cookie: cookies.join("; ") },
    })
  ).json()) as { id: number }[];
  const templateId = templates[0].id;

  const received: string[] = [];
  const ws = new WebSocket(`${WS_URL}/ws?projectId=${projectId}`, {
    headers: { Cookie: sessionCookie },
  });

  const timeout = setTimeout(() => {
    console.error("超时：未收到预期事件", received);
    process.exit(1);
  }, 15_000);

  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as { type: string };
    received.push(msg.type);
    console.log("WS 收到:", msg.type);
    if (msg.type === "subscribed") {
      console.log("已订阅，推送版本…");
      void fetch(`${BASE}/api/templates/${templateId}/versions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          html: `<html><body><h1>WS 实时测试 ${Date.now()}</h1></body></html>`,
          note: "ws-smoke",
        }),
      }).then(async (r) => {
        if (r.status !== 201) {
          console.error("推送失败:", r.status, await r.text());
          process.exit(1);
        }
      });
    }
    if (msg.type === "job") {
      clearTimeout(timeout);
      ws.close();
      const okTypes = ["subscribed", "version", "job"];
      const hasAll = okTypes.every((t) => received.includes(t));
      console.log(hasAll ? "✅ WS 实时链路通过" : `❌ 缺少事件：${received}`);
      process.exit(hasAll ? 0 : 1);
    }
  });

  ws.on("open", () => {
    console.log("WS 已连接，等待订阅确认…");
  });
  ws.on("error", (e) => {
    console.error("WS 错误:", e.message);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error("WS 测试失败:", e);
  process.exit(1);
});
