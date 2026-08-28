BEGIN;

-- ============================================================================
-- 管理员改为「系统级」身份：
--   auth.users.role ∈ { admin 管理员, member 非管理员 }，默认 member。
--   管理员与非管理员的唯一区别 = 只有管理员能管理用户（邀请用户 / 分配项目 /
--   设置用户角色 / 删除账号）。
--   项目成员（edm.project_members）不再携带角色；项目内查看、编辑、删除、
--   API key 与项目设置对所有成员一视同仁，仅项目创建者能删除项目。
-- ============================================================================

-- 1. 系统级角色列
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role text;
UPDATE auth.users u SET role = CASE
  WHEN EXISTS (SELECT 1 FROM edm.projects p WHERE p.owner_id = u.id)
    OR EXISTS (SELECT 1 FROM edm.project_members pm
                WHERE pm.user_id = u.id AND pm.role IN ('owner', 'admin'))
  THEN 'admin' ELSE 'member'
END;
ALTER TABLE auth.users ALTER COLUMN role SET NOT NULL;
ALTER TABLE auth.users ALTER COLUMN role SET DEFAULT 'member';
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE auth.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'member'));
CREATE INDEX IF NOT EXISTS users_role_idx ON auth.users(role);

-- 授权读取/写入 role 列（登录校验走 edm_service，adapter 走 edm_app）
GRANT SELECT (id, role) ON auth.users TO edm_service;
GRANT SELECT (id, role) ON auth.users TO edm_app;
GRANT INSERT (role), UPDATE (role) ON auth.users TO edm_service;
GRANT INSERT (role), UPDATE (role) ON auth.users TO edm_app;

-- 2. 项目成员不再有角色
ALTER TABLE edm.project_members DROP COLUMN IF EXISTS role;

-- ---------------------------------------------------------------------------
-- 3. 辅助函数
-- ---------------------------------------------------------------------------

-- 指定用户是否为系统管理员
CREATE OR REPLACE FUNCTION edm.is_admin_for(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = auth, edm, pg_catalog AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_user AND u.role = 'admin'
  )
$fn$;

-- 当前登录用户（GUC）是否为系统管理员
CREATE OR REPLACE FUNCTION edm.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = auth, edm, pg_catalog AS $fn$
  SELECT edm.is_admin_for(edm.current_user_id())
$fn$;

-- 指定用户是否为某项目成员（含项目创建者）
CREATE OR REPLACE FUNCTION edm.is_member_for(p_user uuid, p_project bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM edm.project_members pm
    WHERE pm.project_id = p_project AND pm.user_id = p_user
  ) OR EXISTS (
    SELECT 1 FROM edm.projects p
    WHERE p.id = p_project AND p.owner_id = p_user
  )
$fn$;

-- 当前登录用户是否为某项目成员（RLS 策略用）
CREATE OR REPLACE FUNCTION edm.is_member(p_project bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT edm.is_member_for(edm.current_user_id(), p_project)
$fn$;

REVOKE ALL ON FUNCTION edm.is_admin_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.is_member_for(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.is_member(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edm.is_admin_for(uuid) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.is_admin() TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.is_member_for(uuid, bigint) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.is_member(bigint) TO edm_app, edm_service;

-- ---------------------------------------------------------------------------
-- 4. RLS 策略重写：项目内所有成员能力一致；用户/成员管理仅系统管理员
-- ---------------------------------------------------------------------------

-- projects
DROP POLICY IF EXISTS projects_select ON edm.projects;
CREATE POLICY projects_select ON edm.projects FOR SELECT TO edm_app
  USING (owner_id = edm.current_user_id() OR edm.is_member(id));

DROP POLICY IF EXISTS projects_insert ON edm.projects;
CREATE POLICY projects_insert ON edm.projects FOR INSERT TO edm_app
  WITH CHECK (owner_id = edm.current_user_id());

DROP POLICY IF EXISTS projects_update ON edm.projects;
CREATE POLICY projects_update ON edm.projects FOR UPDATE TO edm_app
  USING (edm.is_member(id))
  WITH CHECK (edm.is_member(id));

DROP POLICY IF EXISTS projects_delete ON edm.projects;
CREATE POLICY projects_delete ON edm.projects FOR DELETE TO edm_app
  USING (owner_id = edm.current_user_id());

-- project_members（成员资格）
DROP POLICY IF EXISTS project_members_select ON edm.project_members;
CREATE POLICY project_members_select ON edm.project_members FOR SELECT TO edm_app
  USING (edm.is_admin() OR edm.is_member(project_id));

DROP POLICY IF EXISTS project_members_insert ON edm.project_members;
CREATE POLICY project_members_insert ON edm.project_members FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_admin()
    OR (
      user_id = edm.current_user_id()
      AND EXISTS (
        SELECT 1 FROM edm.projects p
        WHERE p.id = project_id AND p.owner_id = edm.current_user_id()
      )
    )
  );

DROP POLICY IF EXISTS project_members_update ON edm.project_members;
CREATE POLICY project_members_update ON edm.project_members FOR UPDATE TO edm_app
  USING (edm.is_admin())
  WITH CHECK (edm.is_admin());

DROP POLICY IF EXISTS project_members_delete ON edm.project_members;
CREATE POLICY project_members_delete ON edm.project_members FOR DELETE TO edm_app
  USING (edm.is_admin());

-- topics
DROP POLICY IF EXISTS topics_select ON edm.topics;
CREATE POLICY topics_select ON edm.topics FOR SELECT TO edm_app
  USING (
    edm.is_member(project_id)
    OR (edm.agent_is_valid() AND edm.agent_project_id() = project_id)
  );

DROP POLICY IF EXISTS topics_insert ON edm.topics;
CREATE POLICY topics_insert ON edm.topics FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id));

DROP POLICY IF EXISTS topics_update ON edm.topics;
CREATE POLICY topics_update ON edm.topics FOR UPDATE TO edm_app
  USING (edm.is_member(project_id))
  WITH CHECK (edm.is_member(project_id));

DROP POLICY IF EXISTS topics_delete ON edm.topics;
CREATE POLICY topics_delete ON edm.topics FOR DELETE TO edm_app
  USING (edm.is_member(project_id));

-- templates
DROP POLICY IF EXISTS templates_select ON edm.templates;
CREATE POLICY templates_select ON edm.templates FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.topic_project(topic_id))
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.topic_project(topic_id)
    )
  );

DROP POLICY IF EXISTS templates_insert ON edm.templates;
CREATE POLICY templates_insert ON edm.templates FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(edm.topic_project(topic_id)));

DROP POLICY IF EXISTS templates_update ON edm.templates;
CREATE POLICY templates_update ON edm.templates FOR UPDATE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id)))
  WITH CHECK (edm.is_member(edm.topic_project(topic_id)));

DROP POLICY IF EXISTS templates_delete ON edm.templates;
CREATE POLICY templates_delete ON edm.templates FOR DELETE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id)));

-- versions
DROP POLICY IF EXISTS versions_select ON edm.versions;
CREATE POLICY versions_select ON edm.versions FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.template_project(template_id))
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.template_project(template_id)
    )
  );

DROP POLICY IF EXISTS versions_insert ON edm.versions;
CREATE POLICY versions_insert ON edm.versions FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_member(edm.template_project(template_id))
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.template_project(template_id)
      AND (
        status = 'draft'
        OR edm.agent_can_approve_on(edm.template_project(template_id))
      )
    )
  );

DROP POLICY IF EXISTS versions_update ON edm.versions;
CREATE POLICY versions_update ON edm.versions FOR UPDATE TO edm_app
  USING (
    status <> 'saved'
    AND (
      edm.is_member(edm.template_project(template_id))
      OR edm.agent_can_approve_on(edm.template_project(template_id))
    )
  )
  WITH CHECK (status = 'saved');

-- version_jobs
DROP POLICY IF EXISTS version_jobs_select ON edm.version_jobs;
CREATE POLICY version_jobs_select ON edm.version_jobs FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.version_project(version_id))
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.version_project(version_id)
    )
  );

-- images
DROP POLICY IF EXISTS images_select ON edm.images;
CREATE POLICY images_select ON edm.images FOR SELECT TO edm_app
  USING (
    edm.is_member(project_id)
    OR (edm.agent_is_valid() AND edm.agent_project_id() = project_id)
  );

DROP POLICY IF EXISTS images_insert ON edm.images;
CREATE POLICY images_insert ON edm.images FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_member(project_id)
    OR (edm.agent_is_valid() AND edm.agent_project_id() = project_id)
  );

DROP POLICY IF EXISTS images_delete ON edm.images;
CREATE POLICY images_delete ON edm.images FOR DELETE TO edm_app
  USING (
    edm.is_member(project_id)
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
      AND source_api_key_id = edm.api_key_id()
    )
  );

DROP POLICY IF EXISTS images_update ON edm.images;
CREATE POLICY images_update ON edm.images FOR UPDATE TO edm_app
  USING (edm.is_member(project_id))
  WITH CHECK (edm.is_member(project_id));

-- project_api_keys：项目内所有成员可管理
DROP POLICY IF EXISTS project_api_keys_select ON edm.project_api_keys;
CREATE POLICY project_api_keys_select ON edm.project_api_keys FOR SELECT TO edm_app
  USING (edm.is_member(project_id));

DROP POLICY IF EXISTS project_api_keys_insert ON edm.project_api_keys;
CREATE POLICY project_api_keys_insert ON edm.project_api_keys FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id));

DROP POLICY IF EXISTS project_api_keys_update ON edm.project_api_keys;
CREATE POLICY project_api_keys_update ON edm.project_api_keys FOR UPDATE TO edm_app
  USING (edm.is_member(project_id))
  WITH CHECK (edm.is_member(project_id));

DROP POLICY IF EXISTS project_api_keys_delete ON edm.project_api_keys;
CREATE POLICY project_api_keys_delete ON edm.project_api_keys FOR DELETE TO edm_app
  USING (edm.is_member(project_id));

-- 旧的两参 is_member(project, min_role) 已被单参版本取代（所有策略已重写）
DROP FUNCTION IF EXISTS edm.is_member(bigint, text);

COMMIT;
