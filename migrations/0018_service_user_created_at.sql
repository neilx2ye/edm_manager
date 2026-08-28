BEGIN;

-- 全局用户管理（仅系统管理员）经 edm_service 读取用户列表时，
-- 需要 createdAt / updatedAt 列权限（此前仅 edm_app 有）。
GRANT SELECT ("createdAt", "updatedAt") ON auth.users TO edm_service;

COMMIT;
