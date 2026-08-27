import fs from "node:fs/promises";
import path from "node:path";

/** 单张图片大小上限（10 MB）。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 允许上传的图片类型：mime → 扩展名（邮件模板常用位图格式）。 */
export const IMAGE_TYPES: Record<string, { ext: string; mime: string }> = {
  "image/png": { ext: "png", mime: "image/png" },
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/webp": { ext: "webp", mime: "image/webp" },
  "image/gif": { ext: "gif", mime: "image/gif" },
};

export function storageRoot(): string {
  return process.env.EDM_STORAGE_DIR || "/var/lib/edm/storage";
}

export function screenshotDirFor(versionId: number | string): string {
  return path.join(storageRoot(), "screenshots", String(versionId));
}

/** 图片相对存储路径（相对 storageRoot），文件名由服务端生成、内容不可信。 */
export function imageRelPath(
  projectId: number,
  fileName: string,
): string {
  return path.join("images", String(projectId), fileName);
}

/** 校验字节魔数与 mime 是否一致，防止把脚本伪装成图片。 */
export function matchesImageMagic(buf: Buffer, mime: string): boolean {
  if (mime === "image/png") {
    return (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    );
  }
  if (mime === "image/jpeg") {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mime === "image/gif") {
    const head = buf.subarray(0, 6).toString("ascii");
    return head === "GIF87a" || head === "GIF89a";
  }
  if (mime === "image/webp") {
    return (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** 把相对路径安全地解析到 storageRoot 内，拒绝目录穿越。 */
function resolveWithinRoot(relPath: string): string {
  const abs = path.resolve(storageRoot(), relPath);
  const root = path.resolve(storageRoot()) + path.sep;
  if (!abs.startsWith(root)) throw new Error("非法存储路径");
  return abs;
}

export async function writeImage(
  relPath: string,
  buf: Buffer,
): Promise<void> {
  const abs = resolveWithinRoot(relPath);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, buf, { flag: "w" });
}

export async function readImage(relPath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(resolveWithinRoot(relPath));
  } catch {
    return null;
  }
}

export async function removeImage(relPath: string): Promise<void> {
  try {
    await fs.unlink(resolveWithinRoot(relPath));
  } catch (e) {
    // 文件不存在即视为已删除；其他情况仅记录，不回滚数据库操作
    const code = (e as { code?: string }).code;
    if (code !== "ENOENT") console.warn("[storage] 删除图片文件失败:", e);
  }
}

export async function readScreenshot(
  versionId: number,
  kind: "desktop" | "mobile",
): Promise<Buffer | null> {
  const file = path.join(screenshotDirFor(versionId), `${kind}.png`);
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}
