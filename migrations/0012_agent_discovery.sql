BEGIN;

-- 让 agent（API key）在其所属项目内只读发现主题与模板，
-- 对应角色矩阵「agent 可查看项目与模板」；创建/管理仍仅限人工。
-- 与 versions / version_jobs 的 agent 子句保持同一模式：
-- agent_is_valid() 为真 且 agent_project_id() 与行所属项目一致。

DROP POLICY IF EXISTS topics_select ON edm.topics;
CREATE POLICY topics_select ON edm.topics FOR SELECT TO edm_app
  USING (
    edm.is_member(project_id, 'viewer')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = project_id
    )
  );

DROP POLICY IF EXISTS templates_select ON edm.templates;
CREATE POLICY templates_select ON edm.templates FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.topic_project(topic_id), 'viewer')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.topic_project(topic_id)
    )
  );

COMMIT;
