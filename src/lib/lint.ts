import * as cheerio from "cheerio";
import type { LintIssue } from "@/db/schema";

/**
 * 邮件兼容性静态检查（MVP 版）。
 * 检查项：外链样式、flex/grid、未内联 class、超宽/无尺寸图片、@import。
 */
export function lintEmailHtml(html: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const $ = cheerio.load(html);

  const styleTags = $("style").text();
  if (/@import/i.test(styleTags) || /url\s*\(/i.test(styleTags)) {
    issues.push({
      rule: "style-import",
      severity: "error",
      message: "style 标签中包含 @import 或 url()，部分邮件客户端会忽略",
    });
  }

  $("link[rel='stylesheet'], link[rel=\"stylesheet\"]").each((_, el) => {
    issues.push({
      rule: "external-stylesheet",
      severity: "error",
      message: `外链样式表 ${$(el).attr("href") || ""} 在邮件客户端会被过滤`,
    });
  });

  const flexGrid = new Set<string>();
  $("[style]").each((_, el) => {
    const style = ($(el).attr("style") || "").toLowerCase();
    if (/(display\s*:\s*(flex|grid))/i.test(style)) {
      const m = style.match(/display\s*:\s*(flex|grid)/i);
      flexGrid.add(m?.[1] ?? "");
    }
    if (/position\s*:\s*(absolute|fixed)/i.test(style)) {
      issues.push({
        rule: "position-absolute",
        severity: "warn",
        message: `${$(el).prop("tagName")} 使用了绝对/固定定位，部分客户端不支持`,
      });
    }
  });
  if (flexGrid.size > 0) {
    issues.push({
      rule: "flex-grid",
      severity: "warn",
      message: `检测到 display:${[...flexGrid].join("/")}，Outlook 等客户端不支持，建议改用 table 布局`,
    });
  }

  let unInlinedClasses = 0;
  $("[class]").each((_, el) => {
    if (!$(el).attr("style")) unInlinedClasses += 1;
  });
  if (unInlinedClasses > 0) {
    issues.push({
      rule: "uninlined-class",
      severity: "warn",
      message: `${unInlinedClasses} 个元素使用 class 但无内联样式，class 样式在邮件中可能丢失`,
    });
  }

  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    const width = parseInt($(el).attr("width") || "", 10);
    const styleWidth = parseInt(
      (($(el).attr("style") || "").match(/width\s*:\s*(\d+)px/) || [])[1] ||
        "",
      10,
    );
    const effective = Number.isFinite(width) ? width : styleWidth;
    if (Number.isFinite(effective) && effective > 600) {
      issues.push({
        rule: "oversized-image",
        severity: "warn",
        message: `图片宽度 ${effective}px 超过 600px，在窄屏客户端可能溢出`,
      });
    }
    if (!Number.isFinite(effective)) {
      issues.push({
        rule: "image-no-size",
        severity: "warn",
        message: `图片缺少 width 尺寸，加载前后布局可能跳动`,
      });
    }
    if (src.startsWith("http://")) {
      issues.push({
        rule: "insecure-image",
        severity: "warn",
        message: "图片使用 http:// 非加密协议，部分客户端会拦截",
      });
    }
  });

  const count = $("table").length;
  if (count === 0 && $("body").text().trim().length > 20) {
    issues.push({
      rule: "no-table",
      severity: "info",
      message: "未检测到 table 布局，复杂排版建议使用 table + 内联样式",
    });
  }

  return issues;
}
