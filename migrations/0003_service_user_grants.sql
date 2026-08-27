BEGIN;

-- edm_service 仅服务端使用：种子/维护流程需要创建预置账号
GRANT INSERT (id, name, email, "emailVerified", image, password_hash, must_change_password, "createdAt", "updatedAt")
  ON auth.users TO edm_service;
GRANT UPDATE (name, email, "emailVerified", image, password_hash, must_change_password, "updatedAt")
  ON auth.users TO edm_service;

COMMIT;
