import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { err, getRequester, ok, parseId } from "@/lib/api";
import { withAgentContext, withUserContext, type Db } from "@/db/context";
import { servicePool } from "@/db/pools";
import type { PoolClient } from "pg";
import { writeAudit } from "@/lib/audit";
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  imageRelPath,
  matchesImageMagic,
  writeImage,
} from "@/lib/storage";
import { route } from "@/lib/route";

/**
 * 项目图片库：
 * - GET：列出项目图片（项目成员或该项目 agent）
 * - POST：上传图片（multipart/form-data，file 字段；项目成员或该项目 agent）
 */
export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  if (requester.kind === "anon") return err(401, "认证失败");
  if (requester.kind === "agent" && requester.key.projectId !== id) {
    return err(403, "API key 无权访问该项目");
  }

  const rows =
    requester.kind === "user"
      ? await withUserContext(requester.user.id, listImages(id))
      : await withAgentContext(id, listImages(id));
  return ok(rows);
});

export const POST = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params;
  const id = parseId(projectId);
  if (!id) return err(400, "无效项目 ID");

  const requester = await getRequester(req);
  if (requester.kind === "anon") return err(401, "认证失败");
  if (requester.kind === "agent" && requester.key.projectId !== id) {
    return err(403, "API key 无权访问该项目");
  }

  // 提前按 Content-Length 拒绝超限请求，避免把超大请求体读进内存
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_IMAGE_BYTES + 64 * 1024) {
    return err(413, `图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return err(400, "请求体需为 multipart/form-data");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return err(400, "缺少 file 字段");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return err(413, `图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
  }

  // 归一化 mime（如 image/jpg → image/jpeg），并校验白名单 + 魔数
  const normalized = normalizeMime(file.type);
  const spec = normalized ? IMAGE_TYPES[normalized] : null;
  if (!spec) {
    return err(415, "仅支持 PNG / JPEG / WebP / GIF 图片");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (!matchesImageMagic(buf, spec.mime)) {
    return err(415, "文件内容与图片类型不符");
  }

  const rawName = (form.get("name") as string | null)?.trim() ?? "";
  const name = (rawName || file.name.replace(/\.[^.]+$/, "") || "未命名")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 200);

  // 文件名由服务端生成（uuid + 白名单扩展名），不信任客户端文件名
  const relPath = imageRelPath(id, `${randomUUID()}.${spec.ext}`);

  const inserted =
    requester.kind === "user"
      ? await withUserContext(requester.user.id, async (_db, client) => {
          const res = await client.query(
            `INSERT INTO edm.images
               (project_id, name, content_type, size_bytes, storage_path, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, content_type, size_bytes, created_at`,
            [
              id,
              name,
              spec.mime,
              buf.length,
              relPath,
              requester.user.id,
            ],
          );
          return res.rows[0] ?? null;
        })
      : await withAgentContext(
          id,
          async (_db, client) => {
            const res = await client.query(
              `INSERT INTO edm.images
                 (project_id, name, content_type, size_bytes, storage_path, source_api_key_id)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id, name, content_type, size_bytes, created_at`,
              [
                id,
                name,
                spec.mime,
                buf.length,
                relPath,
                requester.key.keyId,
              ],
            );
            return res.rows[0] ?? null;
          },
          { keyId: requester.key.keyId },
        );

  if (!inserted) return err(403, "无权上传图片");

  // 落盘失败则回删记录，保持数据库与磁盘一致
  const imageId = Number(inserted.id);
  try {
    await writeImage(relPath, buf);
  } catch (e) {
    await servicePool
      .query("DELETE FROM edm.images WHERE id = $1", [imageId])
      .catch(() => undefined);
    throw e;
  }

  await writeAudit({
    projectId: id,
    actorId: requester.kind === "user" ? requester.user.id : null,
    action: "image.uploaded",
    entityType: "image",
    entityId: imageId,
    payload: { name, contentType: spec.mime, sizeBytes: buf.length },
  });

  return ok(
    { ...inserted, project_id: id, url: `/api/images/${imageId}` },
    201,
  );
});

function normalizeMime(mime: string): string | null {
  if (mime === "image/jpg" || mime === "image/jpeg") return "image/jpeg";
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  if (mime === "image/gif") return "image/gif";
  return null;
}

function listImages(projectId: number) {
  return async (_db: Db, client: PoolClient) => {
    const res = await client.query(
      `SELECT i.id, i.project_id, i.name, i.content_type, i.size_bytes,
              i.created_by::text AS created_by, i.source_api_key_id,
              i.created_at, u.email AS created_by_email, u.name AS created_by_name,
              '/api/images/' || i.id AS url
         FROM edm.images i
         LEFT JOIN auth.users u ON u.id = i.created_by
        WHERE i.project_id = $1
        ORDER BY i.created_at DESC, i.id DESC`,
      [projectId],
    );
    return res.rows;
  };
}
