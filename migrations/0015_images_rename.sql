BEGIN;

-- 图片重命名：项目成员（member+）可更新图片记录。
-- 具体可改的列由 API 层控制（仅 name），RLS 只兜底成员资格。
DROP POLICY IF EXISTS images_update ON edm.images;
CREATE POLICY images_update ON edm.images FOR UPDATE TO edm_app
  USING (edm.is_member(project_id, 'member'))
  WITH CHECK (edm.is_member(project_id, 'member'));

COMMIT;
