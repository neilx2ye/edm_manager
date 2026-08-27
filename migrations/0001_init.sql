-- ============================================================================
-- EDM 邮件模板预览与管理系统 · 初始迁移
-- 以 edm_migrator（schema 所有者）身份执行。
--
-- 设计说明（与 PROJECT_PLAN.md 的差异点）：
--   计划要求 edm.is_member 使用 security invoker。但「团队 → 项目继承」路径下，
--   纯 invoker 函数读取 projects 表会与 projects 的 RLS 策略互相递归
--   （infinite recursion detected in policy）。因此成员资格辅助函数采用
--   security definer（owner = edm_migrator），仅返回布尔/标量、参数受约束、
--   search_path 固定，不暴露任何行数据，是 PG RLS 的标准安全做法。
--   身份上下文仍只信任 SET LOCAL 注入的 edm.current_user_id / edm.api_key_*。
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- auth schema（Auth.js Drizzle adapter 管理；业务代码不直接读写）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text,
  email                 citext NOT NULL UNIQUE,
  "emailVerified"       timestamptz,
  image                 text,
  password_hash         text,
  must_change_password  boolean NOT NULL DEFAULT false,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "sessionToken"  text NOT NULL UNIQUE,
  expires         timestamptz NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.accounts (
  id                 text PRIMARY KEY,
  "userId"           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type               text NOT NULL,
  provider           text NOT NULL,
  "providerAccountId" text NOT NULL,
  refresh_token      text,
  access_token       text,
  expires_at         bigint,
  token_type         text,
  scope              text,
  id_token           text,
  session_state      text,
  UNIQUE (provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS auth.verification_tokens (
  identifier text NOT NULL,
  token      text NOT NULL,
  expires    timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ---------------------------------------------------------------------------
-- edm schema · 业务表
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS edm.teams (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  description text,
  owner_id    uuid NOT NULL REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edm.team_members (
  team_id   bigint NOT NULL REFERENCES edm.teams(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  added_by  uuid REFERENCES auth.users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON edm.team_members(user_id);

CREATE TABLE IF NOT EXISTS edm.projects (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              text NOT NULL,
  description       text,
  team_id           bigint REFERENCES edm.teams(id) ON DELETE SET NULL,
  owner_id          uuid NOT NULL REFERENCES auth.users(id),
  agent_can_approve boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_team_idx ON edm.projects(team_id);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON edm.projects(owner_id);

CREATE TABLE IF NOT EXISTS edm.project_members (
  project_id bigint NOT NULL REFERENCES edm.projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  invited_by uuid REFERENCES auth.users(id),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON edm.project_members(user_id);

CREATE TABLE IF NOT EXISTS edm.templates (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES edm.projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  purpose    text,
  tags       text[] NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_project_idx ON edm.templates(project_id);

CREATE TABLE IF NOT EXISTS edm.project_api_keys (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   bigint NOT NULL REFERENCES edm.projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  role         text NOT NULL DEFAULT 'agent' CHECK (role IN ('agent')),
  created_by   uuid REFERENCES auth.users(id),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_api_keys_project_idx ON edm.project_api_keys(project_id);

CREATE TABLE IF NOT EXISTS edm.versions (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id       bigint NOT NULL REFERENCES edm.templates(id) ON DELETE CASCADE,
  html              text NOT NULL,
  source            text,
  note              text,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved')),
  lint_report       jsonb NOT NULL DEFAULT '[]'::jsonb,
  screenshot_path   text,
  created_by        uuid REFERENCES auth.users(id),
  source_api_key_id bigint REFERENCES edm.project_api_keys(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS versions_template_created_idx ON edm.versions(template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS versions_created_by_idx ON edm.versions(created_by);

CREATE TABLE IF NOT EXISTS edm.version_jobs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id  bigint NOT NULL REFERENCES edm.versions(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('lint', 'screenshot')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  result      jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS version_jobs_status_idx ON edm.version_jobs(status, id);
CREATE INDEX IF NOT EXISTS version_jobs_version_idx ON edm.version_jobs(version_id);

CREATE TABLE IF NOT EXISTS edm.audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint REFERENCES edm.projects(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES auth.users(id),
  action      text NOT NULL,
  entity_type text,
  entity_id   bigint,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_project_created_idx ON edm.audit_logs(project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 辅助函数
-- ---------------------------------------------------------------------------

-- 当前登录用户（只读 GUC，invoker 安全）
CREATE OR REPLACE FUNCTION edm.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('edm.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION edm.role_rank(p_role text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'viewer' THEN 1
    WHEN 'editor' THEN 2
    WHEN 'admin'  THEN 3
    WHEN 'owner'  THEN 4
    ELSE 0
  END
$$;

-- 团队角色 → 项目角色映射（member→viewer、admin→admin、owner→owner）
CREATE OR REPLACE FUNCTION edm.team_effective_role(p_role text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 'owner'
    WHEN 'admin' THEN 'admin'
    WHEN 'member' THEN 'viewer'
    ELSE NULL
  END
$$;

-- 成员资格判定：直接项目角色 与 团队继承角色 取最高。
-- security definer：见文件头说明，避免 RLS 递归；仅返回布尔值。
CREATE OR REPLACE FUNCTION edm.is_member(p_project bigint, p_min_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM (SELECT edm.current_user_id() AS uid) u
    WHERE u.uid IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM edm.project_members pm
          WHERE pm.project_id = p_project
            AND pm.user_id = u.uid
            AND edm.role_rank(pm.role) >= edm.role_rank(p_min_role)
        )
        OR EXISTS (
          SELECT 1
          FROM edm.team_members tm
          JOIN edm.projects p ON p.id = p_project AND p.team_id = tm.team_id
          WHERE tm.user_id = u.uid
            AND edm.role_rank(edm.team_effective_role(tm.role)) >= edm.role_rank(p_min_role)
        )
      )
  )
$fn$;

-- 当前用户在团队中的角色（无则为 null）
CREATE OR REPLACE FUNCTION edm.team_role(p_team bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT tm.role
  FROM edm.team_members tm
  WHERE tm.team_id = p_team
    AND tm.user_id = edm.current_user_id()
  LIMIT 1
$fn$;

-- Agent（API key）上下文，只读 GUC
CREATE OR REPLACE FUNCTION edm.agent_project_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('edm.api_key_project_id', true), '')::bigint
$$;

CREATE OR REPLACE FUNCTION edm.agent_is_valid() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('edm.api_key_valid', true), '') = 'true'
$$;

-- 模板/版本 → 项目 解析（definer，避免策略内部再触发其他表 RLS）
CREATE OR REPLACE FUNCTION edm.template_project(p_template bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT project_id FROM edm.templates WHERE id = p_template
$fn$;

CREATE OR REPLACE FUNCTION edm.version_project(p_version bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT t.project_id
  FROM edm.versions v
  JOIN edm.templates t ON t.id = v.template_id
  WHERE v.id = p_version
$fn$;

CREATE OR REPLACE FUNCTION edm.version_template(p_version bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT template_id FROM edm.versions WHERE id = p_version
$fn$;

-- Agent 能否直接把该项目版本采纳为 saved（项目开关 agent_can_approve）
CREATE OR REPLACE FUNCTION edm.agent_can_approve_on(p_project bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = edm, pg_catalog AS $fn$
  SELECT edm.agent_is_valid()
    AND edm.agent_project_id() = p_project
    AND coalesce(
      (SELECT agent_can_approve FROM edm.projects WHERE id = p_project),
      false
    )
$fn$;

-- ---------------------------------------------------------------------------
-- 触发器
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION edm.notify_version_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = edm, pg_catalog AS $$
BEGIN
  PERFORM pg_notify(
    'edm.version_events',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'op', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION edm.create_version_jobs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = edm, pg_catalog AS $$
BEGIN
  INSERT INTO edm.version_jobs (version_id, kind) VALUES (NEW.id, 'lint');
  IF NEW.status = 'saved' THEN
    INSERT INTO edm.version_jobs (version_id, kind) VALUES (NEW.id, 'screenshot');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION edm.add_screenshot_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = edm, pg_catalog AS $$
BEGIN
  INSERT INTO edm.version_jobs (version_id, kind) VALUES (NEW.id, 'screenshot');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION edm.notify_task_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = edm, pg_catalog AS $$
BEGIN
  PERFORM pg_notify(
    'edm.task_events',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'op', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS versions_after_change ON edm.versions;
CREATE TRIGGER versions_after_change
  AFTER INSERT OR UPDATE OR DELETE ON edm.versions
  FOR EACH ROW EXECUTE FUNCTION edm.notify_version_event();

DROP TRIGGER IF EXISTS versions_after_insert ON edm.versions;
CREATE TRIGGER versions_after_insert
  AFTER INSERT ON edm.versions
  FOR EACH ROW EXECUTE FUNCTION edm.create_version_jobs();

DROP TRIGGER IF EXISTS versions_after_approve ON edm.versions;
CREATE TRIGGER versions_after_approve
  AFTER UPDATE OF status ON edm.versions
  FOR EACH ROW
  WHEN (OLD.status <> 'saved' AND NEW.status = 'saved')
  EXECUTE FUNCTION edm.add_screenshot_job();

DROP TRIGGER IF EXISTS version_jobs_after_change ON edm.version_jobs;
CREATE TRIGGER version_jobs_after_change
  AFTER INSERT OR UPDATE ON edm.version_jobs
  FOR EACH ROW EXECUTE FUNCTION edm.notify_task_event();

-- ---------------------------------------------------------------------------
-- 权限授予
-- ---------------------------------------------------------------------------

-- auth：Auth.js adapter 需要 users/sessions 的读写。
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC;

GRANT SELECT (id, name, email, "emailVerified", image, must_change_password, "createdAt", "updatedAt")
  ON auth.users TO edm_app;
GRANT INSERT (id, name, email, "emailVerified", image, password_hash, must_change_password, "createdAt", "updatedAt")
  ON auth.users TO edm_app;
GRANT UPDATE (name, email, "emailVerified", image, password_hash, must_change_password, "updatedAt")
  ON auth.users TO edm_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.sessions TO edm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.accounts TO edm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.verification_tokens TO edm_app;

-- edm_service：仅服务端，可读取凭据哈希用于登录校验 / API key 校验
GRANT SELECT (id, email, password_hash) ON auth.users TO edm_service;

-- edm 业务表
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA edm TO edm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA edm TO edm_service;

-- API key 哈希对 edm_app 不可读（可写：创建时写入计算好的哈希）
REVOKE SELECT ON edm.project_api_keys FROM edm_app;
GRANT SELECT (id, project_id, name, role, created_by, last_used_at, revoked_at, created_at)
  ON edm.project_api_keys TO edm_app;

-- version_jobs：edm_app 只读；edm_service 可写（后台任务）
REVOKE INSERT, UPDATE, DELETE ON edm.version_jobs FROM edm_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA edm TO edm_app, edm_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO edm_app;

REVOKE ALL ON FUNCTION edm.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.role_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.team_effective_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.is_member(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.team_role(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.agent_project_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.agent_is_valid() FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.template_project(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.version_project(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.version_template(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION edm.agent_can_approve_on(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edm.current_user_id() TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.role_rank(text) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.team_effective_role(text) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.is_member(bigint, text) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.team_role(bigint) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.agent_project_id() TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.agent_is_valid() TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.template_project(bigint) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.version_project(bigint) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.version_template(bigint) TO edm_app, edm_service;
GRANT EXECUTE ON FUNCTION edm.agent_can_approve_on(bigint) TO edm_app, edm_service;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE edm.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.project_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.version_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE edm.audit_logs ENABLE ROW LEVEL SECURITY;

-- teams
CREATE POLICY teams_select ON edm.teams FOR SELECT TO edm_app
  USING (edm.team_role(id) IS NOT NULL);
CREATE POLICY teams_insert ON edm.teams FOR INSERT TO edm_app
  WITH CHECK (owner_id = edm.current_user_id());
CREATE POLICY teams_update ON edm.teams FOR UPDATE TO edm_app
  USING (edm.team_role(id) IN ('owner', 'admin'))
  WITH CHECK (edm.team_role(id) IN ('owner', 'admin'));
CREATE POLICY teams_delete ON edm.teams FOR DELETE TO edm_app
  USING (edm.team_role(id) = 'owner');

-- team_members
CREATE POLICY team_members_select ON edm.team_members FOR SELECT TO edm_app
  USING (edm.team_role(team_id) IS NOT NULL);
CREATE POLICY team_members_insert ON edm.team_members FOR INSERT TO edm_app
  WITH CHECK (edm.team_role(team_id) IN ('owner', 'admin'));
CREATE POLICY team_members_update ON edm.team_members FOR UPDATE TO edm_app
  USING (edm.team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (
    edm.team_role(team_id) IN ('owner', 'admin')
    AND (role <> 'owner' OR edm.team_role(team_id) = 'owner')
  );
CREATE POLICY team_members_delete ON edm.team_members FOR DELETE TO edm_app
  USING (edm.team_role(team_id) IN ('owner', 'admin'));

-- projects
CREATE POLICY projects_select ON edm.projects FOR SELECT TO edm_app
  USING (edm.is_member(id, 'viewer'));
CREATE POLICY projects_insert ON edm.projects FOR INSERT TO edm_app
  WITH CHECK (
    owner_id = edm.current_user_id()
    AND (team_id IS NULL OR edm.team_role(team_id) IN ('owner', 'admin'))
  );
CREATE POLICY projects_update ON edm.projects FOR UPDATE TO edm_app
  USING (edm.is_member(id, 'admin'))
  WITH CHECK (edm.is_member(id, 'admin'));
CREATE POLICY projects_delete ON edm.projects FOR DELETE TO edm_app
  USING (edm.is_member(id, 'owner'));

-- project_members
CREATE POLICY project_members_select ON edm.project_members FOR SELECT TO edm_app
  USING (edm.is_member(project_id, 'viewer'));
CREATE POLICY project_members_insert ON edm.project_members FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id, 'admin'));
CREATE POLICY project_members_update ON edm.project_members FOR UPDATE TO edm_app
  USING (edm.is_member(project_id, 'admin'))
  WITH CHECK (
    edm.is_member(project_id, 'admin')
    AND (role <> 'owner' OR edm.is_member(project_id, 'owner'))
  );
CREATE POLICY project_members_delete ON edm.project_members FOR DELETE TO edm_app
  USING (edm.is_member(project_id, 'admin'));

-- templates
CREATE POLICY templates_select ON edm.templates FOR SELECT TO edm_app
  USING (edm.is_member(project_id, 'viewer'));
CREATE POLICY templates_insert ON edm.templates FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id, 'editor'));
CREATE POLICY templates_update ON edm.templates FOR UPDATE TO edm_app
  USING (edm.is_member(project_id, 'editor'))
  WITH CHECK (edm.is_member(project_id, 'editor'));
CREATE POLICY templates_delete ON edm.templates FOR DELETE TO edm_app
  USING (edm.is_member(project_id, 'admin'));

-- versions（不可变；无 DELETE 策略）
CREATE POLICY versions_select ON edm.versions FOR SELECT TO edm_app
  USING (
    edm.is_member(edm.template_project(template_id), 'viewer')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.template_project(template_id)
    )
  );
CREATE POLICY versions_insert ON edm.versions FOR INSERT TO edm_app
  WITH CHECK (
    edm.is_member(edm.template_project(template_id), 'editor')
    OR (
      edm.agent_is_valid()
      AND edm.agent_project_id() = edm.template_project(template_id)
      AND (
        status = 'draft'
        OR edm.agent_can_approve_on(edm.template_project(template_id))
      )
    )
  );
CREATE POLICY versions_update ON edm.versions FOR UPDATE TO edm_app
  USING (
    status <> 'saved'
    AND (
      edm.is_member(edm.template_project(template_id), 'editor')
      OR edm.agent_can_approve_on(edm.template_project(template_id))
    )
  )
  WITH CHECK (status = 'saved');

-- project_api_keys
CREATE POLICY project_api_keys_select ON edm.project_api_keys FOR SELECT TO edm_app
  USING (edm.is_member(project_id, 'admin'));
CREATE POLICY project_api_keys_insert ON edm.project_api_keys FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(project_id, 'admin'));
CREATE POLICY project_api_keys_update ON edm.project_api_keys FOR UPDATE TO edm_app
  USING (edm.is_member(project_id, 'admin'))
  WITH CHECK (edm.is_member(project_id, 'admin'));
CREATE POLICY project_api_keys_delete ON edm.project_api_keys FOR DELETE TO edm_app
  USING (edm.is_member(project_id, 'admin'));

-- version_jobs（edm_app 只读）
CREATE POLICY version_jobs_select ON edm.version_jobs FOR SELECT TO edm_app
  USING (edm.is_member(edm.version_project(version_id), 'viewer'));

-- audit_logs
CREATE POLICY audit_logs_select ON edm.audit_logs FOR SELECT TO edm_app
  USING (edm.is_member(project_id, 'admin'));
CREATE POLICY audit_logs_insert ON edm.audit_logs FOR INSERT TO edm_app
  WITH CHECK (
    project_id IS NULL
    OR edm.is_member(project_id, 'editor')
  );

COMMIT;
