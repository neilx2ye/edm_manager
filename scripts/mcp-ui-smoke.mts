/**
 * MCP 网页入口冒烟：登录 → 项目设置 MCP tab → API 工具页 MCP 模式。
 * 运行前需已有生产构建并启动服务：
 *   npx tsx scripts/mcp-ui-smoke.mts
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";
let failed = false;

function ok(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed = true;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', "admin@edm.local");
  await page.fill('input[type="password"]', "admin123456");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/templates/, { timeout: 30000 });

  const href = await page
    .locator("a[href*='projectId=']")
    .first()
    .getAttribute("href");
  const projectId = href
    ? new URL(href, BASE).searchParams.get("projectId")
    : null;
  ok("从模板列表发现项目", Boolean(projectId), `projectId=${projectId}`);
  if (!projectId) throw new Error("无法发现项目 ID");

  await page.goto(`${BASE}/projects/${projectId}/settings?tab=mcp`);
  await page.waitForSelector("text=MCP 接入", { timeout: 15000 });
  let text = await page.locator("body").innerText();
  ok("项目设置含 MCP tab", text.includes("MCP 接入"));
  ok("展示 Server URL", text.includes("Server URL"));
  ok("展示 API key 准备区", text.includes("准备 API key"));
  ok("展示客户端配置区", text.includes("配置 MCP 客户端"));
  ok("展示身份工具", text.includes("edm_get_context"));

  await page.goto(`${BASE}/api-tools`);
  await page.getByRole("button", { name: "MCP 接入", exact: true }).click();
  await page.waitForSelector("text=配置 MCP 客户端", { timeout: 15000 });
  text = await page.locator("body").innerText();
  ok("API 工具页可切到 MCP", text.includes("MCP 接入"));
  ok("MCP 模式展示推送工具", text.includes("edm_push_version"));
  ok("无页面 JS 错误", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failed ? "\n❌ MCP UI 冒烟存在失败项" : "\n✅ MCP UI 冒烟全部通过");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("MCP UI 冒烟失败:", e);
  process.exit(1);
});
