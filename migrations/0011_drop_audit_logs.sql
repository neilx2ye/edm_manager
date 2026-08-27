BEGIN;

-- 移除审计日志功能以节省存储空间
DROP TABLE IF EXISTS edm.audit_logs;

COMMIT;
