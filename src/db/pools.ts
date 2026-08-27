import pg, { Pool } from "pg";

// int8（bigint）默认由 node-postgres 序列化为字符串；这里统一解析为 number，
// 与前端类型契约（id 等为 number）保持一致。uuid 等类型不受影响。
pg.types.setTypeParser(20, (value) => Number(value));

function poolFromUrl(url: string | undefined, name: string): Pool {
  if (!url) {
    throw new Error(`缺少数据库连接串：${name}`);
  }
  const p = new Pool({ connectionString: url, max: 8 });
  p.on("error", (err) => {
    // 避免空闲连接错误导致进程退出
    console.error(`[db:${name}] 空闲连接错误:`, err.message);
  });
  return p;
}

// 业务查询角色（RLS 生效）
export const appPool = poolFromUrl(process.env.EDM_APP_DATABASE_URL, "edm_app");
// 服务端内部角色（BYPASSRLS：API key 校验、登录校验、后台任务、LISTEN/NOTIFY）
export const servicePool = poolFromUrl(
  process.env.EDM_SERVICE_DATABASE_URL,
  "edm_service",
);
// 迁移角色（schema 所有者）
export const migratorPool = poolFromUrl(process.env.DATABASE_URL, "edm_migrator");
