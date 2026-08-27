BEGIN;

-- 全局用户管理需要删除账号：授权 edm_app 对 auth.users 的 DELETE。
-- 删除受应用层守卫（需 admin+、不能删自己、不能删项目 owner）约束。
GRANT DELETE ON auth.users TO edm_app;

COMMIT;
