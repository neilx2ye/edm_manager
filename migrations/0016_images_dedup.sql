BEGIN;

-- 图片内容排重：记录上传内容的 SHA-256，
-- 同一项目内内容相同的图片只保留一条记录（唯一部分索引）。
ALTER TABLE edm.images ADD COLUMN sha256 text;

-- 存量行 sha256 为 NULL，不参与排重（由 backfill 脚本回填）；
-- 新上传一律写入 sha256，靠此索引在并发下原子去重。
CREATE UNIQUE INDEX images_project_sha256_uidx
  ON edm.images (project_id, sha256)
  WHERE sha256 IS NOT NULL;

COMMIT;
