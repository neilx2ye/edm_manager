BEGIN;

-- ============================================================================
-- 结构调整：权限与内容收敛为三层「项目 → 主题 → 模板」，移除团队层。
-- ============================================================================

-- 1. 主题表
CREATE TABLE edm.topics (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES edm.projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  purpose    text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topics_project_idx ON edm.topics(project_id);

-- 2. 为每个已有项目创建默认主题，承接现有模板
INSERT INTO edm.topics (project_id, name, purpose, created_by)
SELECT p.id, '默认主题', '迁移自旧版项目的模板', p.owner_id
FROM edm.projects p;

-- 3. templates 挂到主题
ALTER TABLE edm.templates ADD COLUMN topic_id bigint;
UPDATE edm.templates t
   SET topic_id = (
     SELECT tp.id FROM edm.topics tp WHERE tp.project_id = t.project_id
   );
ALTER TABLE edm.templates ALTER COLUMN topic_id SET NOT NULL;
ALTER TABLE edm.templates
  ADD CONSTRAINT templates_topic_id_fkey
  FOREIGN KEY (topic_id) REFERENCES edm.topics(id) ON DELETE CASCADE;
CREATE INDEX templates_topic_idx ON edm.templates(topic_id);

-- 4. 移除旧的 project 直挂与团队层
DROP POLICY IF EXISTS templates_select ON edm.templates;
DROP POLICY IF EXISTS templates_insert ON edm.templates;
DROP POLICY IF EXISTS templates_update ON edm.templates;
DROP POLICY IF EXISTS templates_delete ON edm.templates;
ALTER TABLE edm.templates DROP COLUMN project_id;
DROP POLICY IF EXISTS projects_insert ON edm.projects;
ALTER TABLE edm.projects DROP COLUMN team_id;
DROP TABLE edm.team_members;
DROP TABLE edm.teams;

-- 5. 成员资格收敛为「项目直接成员」一种来源
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

-- 主题 → 项目 / 模板 → 项目 解析
CREATE OR REPLACE FUNCTION edm.topic_project(p_topic bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT project_id FROM edm.topics WHERE id = p_topic
$fn$;

CREATE OR REPLACE FUNCTION edm.template_project(p_template bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT tp.project_id
  FROM edm.templates tm
  JOIN edm.topics tp ON tp.id = tm.topic_id
  WHERE tm.id = p_template
$fn$;

CREATE OR REPLACE FUNCTION edm.version_project(p_version bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT tp.project_id
  FROM edm.versions v
  JOIN edm.templates tm ON tm.id = v.template_id
  JOIN edm.topics tp ON tp.id = tm.topic_id
  WHERE v.id = p_version
$fn$;

DROP FUNCTION IF EXISTS edm.team_role(bigint);
DROP FUNCTION IF EXISTS edm.team_effective_role(text);

-- 6. 授权
GRANT SELECT, INSERT, UPDATE, DELETE ON edm.topics TO edm_app, edm_service;
GRANT USAGE, SELECT ON SEQUENCE edm.topics_id_seq TO edm_app, edm_service;
REVOKE ALL ON FUNCTION edm.topic_project(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edm.topic_project(bigint) TO edm_app, edm_service;

-- 7. RLS
ALTER TABLE edm.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY topics_select ON edm.topics FOR SELECT TO edm_app
  USING (edm.is_member(project_id, 'viewer'));
CREATE POLICY topics_insert ON edm.topics FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id, 'editor'));
CREATE POLICY topics_update ON edm.topics FOR UPDATE TO edm_app
  USING (edm.is_member(project_id, 'editor'))
  WITH CHECK (edm.is_member(project_id, 'editor'));
CREATE POLICY topics_delete ON edm.topics FOR DELETE TO edm_app
  USING (edm.is_member(project_id, 'admin'));

-- templates 策略改为经 topic 解析项目
DROP POLICY IF EXISTS templates_select ON edm.templates;
DROP POLICY IF EXISTS templates_insert ON edm.templates;
DROP POLICY IF EXISTS templates_update ON edm.templates;
DROP POLICY IF EXISTS templates_delete ON edm.templates;
CREATE POLICY templates_select ON edm.templates FOR SELECT TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'viewer'));
CREATE POLICY templates_insert ON edm.templates FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(edm.topic_project(topic_id), 'editor'));
CREATE POLICY templates_update ON edm.templates FOR UPDATE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'editor'))
  WITH CHECK (edm.is_member(edm.topic_project(topic_id), 'editor'));
CREATE POLICY templates_delete ON edm.templates FOR DELETE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'admin'));

-- projects 插入策略去掉团队检查
DROP POLICY IF EXISTS projects_insert ON edm.projects;
CREATE POLICY projects_insert ON edm.projects FOR INSERT TO edm_app
  WITH CHECK (owner_id = edm.current_user_id());

COMMIT;
