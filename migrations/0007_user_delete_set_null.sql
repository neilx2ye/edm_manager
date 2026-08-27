BEGIN;

-- 删除账号时保留业务历史：把记录「创建人/操作人/邀请人」的外键改为 SET NULL。
-- projects.owner_id 保持 NOT NULL + NO ACTION，由删除接口前置守卫（owner 账号不可删）。

ALTER TABLE edm.audit_logs
  DROP CONSTRAINT audit_logs_actor_id_fkey,
  ADD CONSTRAINT audit_logs_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE edm.project_api_keys
  DROP CONSTRAINT project_api_keys_created_by_fkey,
  ADD CONSTRAINT project_api_keys_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE edm.project_members
  DROP CONSTRAINT project_members_invited_by_fkey,
  ADD CONSTRAINT project_members_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE edm.templates
  DROP CONSTRAINT templates_created_by_fkey,
  ADD CONSTRAINT templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE edm.topics
  DROP CONSTRAINT topics_created_by_fkey,
  ADD CONSTRAINT topics_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE edm.versions
  DROP CONSTRAINT versions_created_by_fkey,
  ADD CONSTRAINT versions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;
