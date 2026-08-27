/**
 * 生产构建 UI 冒烟：登录 → 模板列表 → 模板详情（iframe/时间线/WS）→ 项目设置。
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";

function ok(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/login`);
  ok("登录页渲染（邮箱输入框）", (await page.locator('input[type="email"]').count()) === 1);

  await page.fill('input[type="email"]', "admin@edm.local");
  await page.fill('input[type="password"]', "admin123456");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/templates/, { timeout: 30000 });
  ok("登录后跳转模板列表", true);

  await page.waitForSelector("text=新品首发通知", { timeout: 15000 });
  const cards = await page.locator("a[href*='/templates/']").count();
  ok("模板卡片渲染", cards >= 1, `卡片数=${cards}`);

  // 左侧栏结构：项目切换下拉 + 主题折叠组 + API 客户端 / 用户
  const sidebar = page.locator("aside").first();
  await sidebar.waitFor({ timeout: 15000 });
  await sidebar.getByText("活动营销").waitFor({ timeout: 15000 }).catch(() => {});
  const sideText = await sidebar.innerText();
  ok("侧栏含主题分组", sideText.includes("主题"));
  ok("侧栏含全部模板入口", sideText.includes("全部模板"));
  ok("侧栏含主题名", sideText.includes("活动营销"));
  ok("侧栏含设置入口", sideText.includes("设置"));
  ok("侧栏含用户管理入口", sideText.includes("用户管理"));

  // 点击主题 → URL 带 topicId
  await sidebar.getByRole("link", { name: /活动营销/ }).click();
  await page.waitForURL(/topicId=/, { timeout: 15000 });
  ok("点击主题后 URL 带 topicId", /topicId=/.test(page.url()));

  const detailHref = await page
    .locator("a[href*='/templates/']")
    .first()
    .getAttribute("href");
  ok("详情页链接携带 projectId", /projectId=/.test(detailHref || ""));
  await page.goto(`${BASE}${detailHref}`);
  await page.waitForSelector("iframe", { timeout: 30000 });
  ok("详情页 iframe 预览渲染", true);
  await page.waitForTimeout(1000);
  const wsText = await page.locator("body").innerText();
  ok("详情页时间线/状态出现", /saved|draft|版本/i.test(wsText));
  const detailSide = await sidebar.innerText();
  ok(
    "详情页侧栏项目选择保持",
    detailSide.includes("活动营销") && !detailSide.includes("选择项目"),
  );
  const copyCodeBtn = page.getByRole("button", {
    name: /复制代码|已复制|复制失败/,
  });
  ok("详情页含复制代码按钮", await copyCodeBtn.isVisible());
  ok(
    "详情页含代码定位面板 tab",
    await page.getByRole("button", { name: "代码", exact: true }).isVisible(),
  );
  await page.getByRole("button", { name: "代码", exact: true }).click();
  ok(
    "代码面板可编辑并含格式化按钮",
    await page.getByRole("button", { name: "格式化", exact: true }).isVisible(),
  );
  ok(
    "代码面板含语法高亮编辑器",
    await page.locator(".cm-editor").isVisible(),
  );
  ok(
    "渲染区与面板间含可拖拽分隔条",
    await page
      .getByRole("separator", { name: "拖动调整面板宽度" })
      .isVisible(),
  );

  // 项目设置
  await page.goto(`${BASE}/projects/1/settings`);
  await page.waitForSelector("text=API", { timeout: 30000 }).catch(() => {});
  const bodyText = await page.locator("body").innerText();
  ok("项目设置页渲染", /成员|API/i.test(bodyText));

  // 项目设置 - 主题 tab
  await page.goto(`${BASE}/projects/1/settings`);
  await page.waitForSelector("text=主题", { timeout: 30000 }).catch(() => {});
  const settingsText = await page.locator("body").innerText();
  ok("项目设置页含主题 tab", /主题/.test(settingsText));

  // 侧栏「设置」入口直达设置页
  await page.locator("aside").getByText("设置", { exact: true }).click();
  await page.waitForURL(/\/settings$/, { timeout: 15000 });
  ok("侧栏设置入口直达设置页", /\/projects\/1\/settings$/.test(page.url()));

  // 全局用户管理页
  await page.goto(`${BASE}/users`);
  await page.waitForSelector("text=新建用户", { timeout: 15000 }).catch(() => {});
  const usersText = await page.locator("body").innerText();
  ok("用户管理页渲染", /新建用户|修改我的密码|admin@edm\.local/.test(usersText));
  ok("用户管理页含删除账号", usersText.includes("删除账号"));

  ok("无页面 JS 错误", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(process.exitCode ? "\n❌ UI 冒烟存在失败项" : "\n✅ UI 冒烟全部通过");
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error("UI 冒烟失败:", e);
  process.exit(1);
});
