BEGIN;

-- 修复：INSERT ... RETURNING 会再应用 SELECT 策略；原 projects_select 自引用查
-- project_members，新建项目时新行不可见导致误拒。增加行上 owner_id 直接分支。

DROP POLICY IF EXISTS projects_select ON edm.projects;
CREATE POLICY projects_select ON edm.projects FOR SELECT TO edm_app
  USING (owner_id = edm.current_user_id() OR edm.is_member(id, 'viewer'));

COMMIT;
