/**
 * 一次性回填：为存量图片计算 SHA-256，写入 edm.images.sha256，
 * 使内容排重覆盖历史图片。
 * 运行：npx tsx --env-file=.env scripts/backfill-image-sha256.ts
 */
import { createHash } from "node:crypto";
import { servicePool } from "../src/db/pools";
import { readImage } from "../src/lib/storage";

async function main() {
  const { rows } = await servicePool.query<{
    id: number;
    project_id: number;
    storage_path: string;
  }>(
    `SELECT id, project_id, storage_path
       FROM edm.images
      WHERE sha256 IS NULL
      ORDER BY id`,
  );

  let updated = 0;
  let skippedDuplicate = 0;
  let missingFile = 0;

  for (const row of rows) {
    const buf = await readImage(row.storage_path);
    if (!buf) {
      missingFile++;
      console.warn(`[skip] 文件缺失 #${row.id} ${row.storage_path}`);
      continue;
    }
    const hash = createHash("sha256").update(buf).digest("hex");
    try {
      const res = await servicePool.query(
        `UPDATE edm.images SET sha256 = $1 WHERE id = $2 AND sha256 IS NULL`,
        [hash, row.id],
      );
      if (res.rowCount === 1) updated++;
      else skippedDuplicate++;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        skippedDuplicate++;
        console.warn(
          `[dup] #${row.id} 与项目 ${row.project_id} 内已有图片内容相同，保留 NULL（不参与排重）`,
        );
      } else {
        throw e;
      }
    }
  }

  console.log({
    total: rows.length,
    updated,
    skippedDuplicate,
    missingFile,
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
