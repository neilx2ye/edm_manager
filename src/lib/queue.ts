import type { Browser } from "playwright";
import path from "node:path";
import { servicePool } from "@/db/pools";
import { lintEmailHtml } from "./lint";
import { ensureDir, screenshotDirFor } from "./storage";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // 延迟 require，避免 API 路由打包时加载 Playwright
    const { chromium } = await import("playwright");
    browserPromise = chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
}

async function runLint(versionId: number): Promise<unknown> {
  const res = await servicePool.query(
    "SELECT html FROM edm.versions WHERE id = $1",
    [versionId],
  );
  const html = res.rows[0]?.html ?? "";
  const report = lintEmailHtml(html);
  await servicePool.query("UPDATE edm.versions SET lint_report = $2 WHERE id = $1", [
    versionId,
    JSON.stringify(report),
  ]);
  return { issues: report, count: report.length };
}

async function runScreenshot(versionId: number): Promise<unknown> {
  const res = await servicePool.query(
    "SELECT html FROM edm.versions WHERE id = $1",
    [versionId],
  );
  const html = res.rows[0]?.html ?? "";
  const dir = screenshotDirFor(versionId);
  await ensureDir(dir);

  const browser = await getBrowser();
  const viewports = [
    { kind: "desktop", width: 1280, height: 900 },
    { kind: "mobile", width: 390, height: 844 },
  ] as const;

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      // 等待邮件内嵌图片基本加载
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(dir, `${vp.kind}.png`),
        fullPage: true,
      });
    }
  } finally {
    await page.close();
  }

  await servicePool.query(
    "UPDATE edm.versions SET screenshot_path = $2 WHERE id = $1",
    [versionId, `screenshots/${versionId}`],
  );
  return { desktop: true, mobile: true };
}

/**
 * 进程内任务队列：lint / 截图，并发固定为 1（资源评估要求）。
 */
class TaskQueue {
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), 1000);
    console.log("[queue] 后台任务队列已启动");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.processNext();
    } catch (err) {
      console.error("[queue] 处理任务失败:", err);
    } finally {
      this.running = false;
    }
  }

  private async processNext(): Promise<void> {
    const client = await servicePool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `UPDATE edm.version_jobs
            SET status = 'running', started_at = now()
          WHERE id = (
            SELECT id FROM edm.version_jobs
             WHERE status = 'pending'
             ORDER BY id
             LIMIT 1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id, version_id, kind`,
      );
      await client.query("COMMIT");
      const job = claimed.rows[0];
      if (!job) return;

      const versionId = Number(job.version_id);
      try {
        const result =
          job.kind === "lint"
            ? await runLint(versionId)
            : await runScreenshot(versionId);
        await client.query(
          `UPDATE edm.version_jobs
              SET status = 'done', result = $2, finished_at = now()
            WHERE id = $1`,
          [job.id, JSON.stringify(result)],
        );
        console.log(`[queue] job #${job.id} (${job.kind}) 完成`);
      } catch (err) {
        await client.query(
          `UPDATE edm.version_jobs
              SET status = 'failed', error = $2, finished_at = now()
            WHERE id = $1`,
          [job.id, String((err as Error)?.message ?? err)],
        );
        console.error(`[queue] job #${job.id} (${job.kind}) 失败:`, err);
      }
    } finally {
      client.release();
    }
  }
}

export const taskQueue = new TaskQueue();
