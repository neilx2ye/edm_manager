BEGIN;

-- ============================================================================
-- 用户管理角色收敛：项目成员仅保留两级角色。
--   admin  管理员：可邀请新用户、分配项目（管理成员 / API key / 项目设置），
--                   并拥有全部编辑与查看能力。
--   member 非管理员：对所在项目拥有编辑与查看能力，不能管理用户与成员。
-- 项目创建者仍以 projects.owner_id 记录（内部概念，展示为「管理员」），
-- 并保留「仅创建者可删除项目」的兜底约束。
-- ============================================================================

-- 1. 存量角色收敛：owner/admin → admin；editor/viewer → member
UPDATE edm.project_members SET role = 'admin' WHERE role IN ('owner', 'admin');
UPDATE edm.project_members SET role = 'member' WHERE role IN ('editor', 'viewer');

-- 2. 收紧角色枚举
ALTER TABLE edm.project_members DROP CONSTRAINT project_members_role_check;
ALTER TABLE edm.project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('admin', 'member'));

-- 3. 角色等级：member=1、admin=2；owner 保留为内部等级 3（仅 projects.owner_id 使用）
CREATE OR REPLACE FUNCTION edm.role_rank(p_role text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'member' THEN 1
    WHEN 'admin'  THEN 2
    WHEN 'owner'  THEN 3
    ELSE 0
  END
$$;

-- ---------------------------------------------------------------------------
-- RLS 策略重写：查看/编辑 → member；管理（删除内容、成员、API key、设置）→ admin；
-- 删除项目 → owner（仅项目创建者）。
-- ---------------------------------------------------------------------------

-- projects
DROP POLICY IF EXISTS projects_select ON edm.projects;
CREATE POLICY projects_select ON edm.projects FOR SELECT TO edm_app
  USING (owner_id = edm.current_user_id() OR edm.is_member(id, 'member'));

-- project_members
DROP POLICY IF EXISTS project_members_select ON edm.project_members;
CREATE POLICY project_members_select ON edm.project_members FOR SELECT TO edm_app
  USING (edm.is_member(project_id, 'member'));

DROP POLICY IF EXISTS project_members_insert ON edm.project_members;
CREATE POLICY project_members_insert ON edm.project_members FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id, 'admin'));

DROP POLICY IF EXISTS project_members_update ON edm.project_members;
CREATE POLICY project_members_update ON edm.project_members FOR UPDATE TO edm_app
  USING (edm.is_member(project_id, 'admin'))
  WITH CHECK (edm.is_member(project_id, 'admin'));

DROP POLICY IF EXISTS project_members_delete ON edm.project_members;
CREATE POLICY project_members_delete ON edm.project_members FOR DELETE TO edm_app
  USING (edm.is_member(project_id, 'admin'));

-- topics
DROP POLICY IF EXISTS topics_select ON edm.topics;
CREATE POLICY topics_select ON edm.topics FOR SELECT TO edm_app
  USING (
    edm.is_member(project_id, 'member')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
    )
  );

DROP POLICY IF EXISTS topics_insert ON edm.topics;
CREATE POLICY topics_insert ON edm.topics FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id, 'member'));

DROP POLICY IF EXISTS topics_update ON edm.topics;
CREATE POLICY topics_update ON edm.topics FOR UPDATE TO edm_app
  USING (edm.is_member(project_id, 'member'))
  WITH CHECK (edm.is_member(project_id, 'member'));

DROP POLICY IF EXISTS topics_delete ON edm.topics;
CREATE POLICY topics_delete ON edm.topics FOR DELETE TO edm_app
  USING (edm.is_member(project_id, 'admin'));

-- templates
DROP POLICY IF EXISTS templates_select ON edm.templates;
CREATE POLICY templates_select ON edm.templates FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.topic_project(topic_id), 'member')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.topic_project(topic_id)
    )
  );

DROP POLICY IF EXISTS templates_insert ON edm.templates;
CREATE POLICY templates_insert ON edm.templates FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(edm.topic_project(topic_id), 'member'));

DROP POLICY IF EXISTS templates_update ON edm.templates;
CREATE POLICY templates_update ON edm.templates FOR UPDATE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'member'))
  WITH CHECK (edm.is_member(edm.topic_project(topic_id), 'member'));

DROP POLICY IF EXISTS templates_delete ON edm.templates;
CREATE POLICY templates_delete ON edm.templates FOR DELETE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'admin'));

-- versions
DROP POLICY IF EXISTS versions_select ON edm.versions;
CREATE POLICY versions_select ON edm.versions FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.template_project(template_id), 'member')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.template_project(template_id)
    )
  );

DROP POLICY IF EXISTS versions_insert ON edm.versions;
CREATE POLICY versions_insert ON edm.versions FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_member(edm.template_project(template_id), 'member')
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
      edm.is_member(edm.template_project(template_id), 'member')
      OR edm.agent_can_approve_on(edm.template_project(template_id))
    )
  )
  WITH CHECK (status = 'saved');

-- version_jobs
DROP POLICY IF EXISTS version_jobs_select ON edm.version_jobs;
CREATE POLICY version_jobs_select ON edm.version_jobs FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.version_project(version_id), 'member')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.version_project(version_id)
    )
  );

-- images
DROP POLICY IF EXISTS images_select ON edm.images;
CREATE POLICY images_select ON edm.images FOR SELECT TO edm_app
  USING (
    edm.is_member(project_id, 'member')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
    )
  );

DROP POLICY IF EXISTS images_insert ON edm.images;
CREATE POLICY images_insert ON edm.images FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_member(project_id, 'member')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
    )
  );

DROP POLICY IF EXISTS images_delete ON edm.images;
CREATE POLICY images_delete ON edm.images FOR DELETE TO edm_app
  USING (
    edm.is_member(project_id, 'admin')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
      AND source_api_key_id = edm.api_key_id()
    )
  );

COMMIT;
