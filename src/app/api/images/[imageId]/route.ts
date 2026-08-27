import { NextRequest } from "next/server";
import { err, getRequester, ok, parseId } from "@/lib/api";
import { checkMembership, withAgentContext, withUserContext } from "@/db/context";
import { servicePool } from "@/db/pools";
import { writeAudit } from "@/lib/audit";
import { readImage, removeImage } from "@/lib/storage";
import { route } from "@/lib/route";

interface ImageMeta {
  projectId: number;
  name: string;
  contentType: string;
  storagePath: string;
}

/**
 * 读取图片原图（项目成员或该项目 agent）。
 * 同一路径既供管理页 <img> 渲染（走会话 cookie），也供 agent 用 Bearer key 拉取。
 */
export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) => {
  const { imageId } = await params;
  const id = parseId(imageId);
  if (!id) return err(400, "无效图片 ID");

  const requester = await getRequester(req);
  if (requester.kind === "anon") return err(401, "认证失败");

  const meta = await imageMeta(id);
  if (!meta) return err(404, "图片不存在");
  if (requester.kind === "agent" && requester.key.projectId !== meta.projectId) {
    return err(403, "无权访问");
  }
  if (
    requester.kind === "user" &&
    !(await checkMembership(requester.user.id, meta.projectId, "member"))
  ) {
    return err(403, "无权访问");
  }

  const buf = await readImage(meta.storagePath);
  if (!buf) return err(404, "图片文件缺失");

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": meta.contentType,
      "Content-Length": String(buf.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/** 删除图片：项目管理员，或上传该图片的 agent 本人。 */
export const DELETE = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) => {
  const { imageId } = await params;
  const id = parseId(imageId);
  if (!id) return err(400, "无效图片 ID");

  const requester = await getRequester(req);
  if (requester.kind === "anon") return err(401, "认证失败");

  const meta = await imageMeta(id);
  if (!meta) return err(404, "图片不存在");
  if (requester.kind === "agent" && requester.key.projectId !== meta.projectId) {
    return err(403, "无权操作");
  }

  const deleted =
    requester.kind === "user"
      ? await withUserContext(requester.user.id, async (_db, client) => {
          const res = await client.query(
            "DELETE FROM edm.images WHERE id = $1 RETURNING id",
            [id],
          );
          return res.rowCount === 1;
        })
      : await withAgentContext(
          meta.projectId,
          async (_db, client) => {
            const res = await client.query(
              "DELETE FROM edm.images WHERE id = $1 RETURNING id",
              [id],
            );
            return res.rowCount === 1;
          },
          { keyId: requester.key.keyId },
        );

  if (!deleted) return err(403, "无权删除该图片");
  await removeImage(meta.storagePath);

  await writeAudit({
    projectId: meta.projectId,
    actorId: requester.kind === "user" ? requester.user.id : null,
    action: "image.deleted",
    entityType: "image",
    entityId: id,
    payload: { name: meta.name },
  });

  return ok({ ok: true });
});

async function imageMeta(imageId: number): Promise<ImageMeta | null> {
  const res = await servicePool.query(
    `SELECT project_id, name, content_type, storage_path
       FROM edm.images
      WHERE id = $1`,
    [imageId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    projectId: Number(row.project_id),
    name: String(row.name),
    contentType: String(row.content_type),
    storagePath: String(row.storage_path),
  };
}
