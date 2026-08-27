BEGIN;

-- ============================================================================
-- 图片库：项目级图片资产。
-- AI agent（API key）可上传 / 查看 / 删除自己上传的图片；
-- 登录用户在管理页上传（editor+）与删除（admin+）。
-- 文件本体存于 EDM_STORAGE_DIR/images/<projectId>/<id>.<ext>。
-- ============================================================================

CREATE TABLE edm.images (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id        bigint NOT NULL REFERENCES edm.projects(id) ON DELETE CASCADE,
  name              text NOT NULL,
  content_type      text NOT NULL,
  size_bytes        bigint NOT NULL,
  storage_path      text NOT NULL,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_api_key_id bigint REFERENCES edm.project_api_keys(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX images_project_created_idx ON edm.images(project_id, created_at);

-- agent 上下文补充：当前 API key id（用于「agent 只能删自己上传的图片」）。
CREATE OR REPLACE FUNCTION edm.api_key_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('edm.api_key_id', true), '')::bigint
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON edm.images TO edm_app, edm_service;
GRANT USAGE, SELECT ON SEQUENCE edm.images_id_seq TO edm_app, edm_service;

REVOKE ALL ON FUNCTION edm.api_key_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edm.api_key_id() TO edm_app, edm_service;

ALTER TABLE edm.images ENABLE ROW LEVEL SECURITY;

-- 查看：项目成员（viewer+）或该项目的 agent
CREATE POLICY images_select ON edm.images FOR SELECT TO edm_app
  USING (
    edm.is_member(project_id, 'viewer')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
    )
  );

-- 上传：项目成员（editor+）或该项目的 agent
CREATE POLICY images_insert ON edm.images FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_member(project_id, 'editor')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
    )
  );

-- 删除：项目管理员，或上传该图片的 agent 本人
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
