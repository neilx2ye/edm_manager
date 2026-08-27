BEGIN;

-- 修复：项目 owner 在插入首个 project_members 行之前，is_member 无法通过成员表判定，
-- 导致经应用层（RLS）新建项目/分配首个成员失败。将 projects.owner_id 视为 owner 级
-- 权限来源（owner_id 不可被业务更新，安全）。

CREATE OR REPLACE FUNCTION edm.is_member(p_project bigint, p_min_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT EXISTS (
    SELECT 1
    WHERE edm.current_user_id() IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM edm.project_members pm
          WHERE pm.project_id = p_project
            AND pm.user_id = edm.current_user_id()
            AND edm.role_rank(pm.role) >= edm.role_rank(p_min_role)
        )
        OR EXISTS (
          SELECT 1 FROM edm.projects p
          WHERE p.id = p_project
            AND p.owner_id = edm.current_user_id()
            AND edm.role_rank('owner') >= edm.role_rank(p_min_role)
        )
      )
  )
$fn$;

COMMIT;
