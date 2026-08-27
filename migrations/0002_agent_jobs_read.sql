BEGIN;

-- agent 读取版本时同样需要看到 lint/截图任务状态
DROP POLICY IF EXISTS version_jobs_select ON edm.version_jobs;
CREATE POLICY version_jobs_select ON edm.version_jobs FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.version_project(version_id), 'viewer')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.version_project(version_id)
    )
  );

COMMIT;
