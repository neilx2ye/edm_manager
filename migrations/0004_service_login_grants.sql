BEGIN;

-- 登录校验（authorize）需要读 name / must_change_password
GRANT SELECT (id, email, name, password_hash, must_change_password)
  ON auth.users TO edm_service;

COMMIT;
