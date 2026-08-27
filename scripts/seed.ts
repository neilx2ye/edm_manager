/**
 * 种子数据（幂等）：
 *  - 演示账号 admin@edm.local / admin123456（已改密标记清除）
 *  - 演示项目 + 两个主题 + 示例模板 + 两个示例版本
 * 以 edm_service 角色写入（模拟服务端），演示 RLS 策略在真实请求下生效。
 */
import { hashPassword } from "../src/lib/password";
import { servicePool } from "../src/db/pools";
import type { PoolClient } from "pg";

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#4f46e5;padding:28px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-family:Arial,sans-serif;">🎉 新品首发</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;font-family:Arial,sans-serif;color:#1f2937;">
              <h2 style="margin:0 0 12px;font-size:20px;">你好，{{name}}</h2>
              <p style="font-size:15px;line-height:1.7;color:#4b5563;">这是一封用于演示的 EDM 邮件模板。实时预览、版本时间线与 lint 检查都会围绕它展开。</p>
              <p style="text-align:center;margin:28px 0;">
                <a href="https://example.com" style="background:#4f46e5;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:15px;">立即查看</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background:#f9fafb;color:#9ca3af;font-size:12px;font-family:Arial,sans-serif;">
              如果不想再收到此类邮件，<a href="{{unsubscribe}}" style="color:#6b7280;">点击退订</a>。
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

async function findOrCreate(
  client: PoolClient,
  sql: string,
  params: unknown[],
  findSql: string,
  findParams: unknown[],
): Promise<number> {
  const found = await client.query(findSql, findParams);
  if (found.rowCount === 1) return Number(found.rows[0].id);
  const created = await client.query(`${sql} RETURNING id`, params);
  return Number(created.rows[0].id);
}

async function main() {
  const client = await servicePool.connect();
  try {
    // 1. 演示账号
    const existing = await client.query(
      "SELECT id FROM auth.users WHERE email = 'admin@edm.local'",
    );
    let userId: string;
    if (existing.rowCount === 0) {
      const hash = await hashPassword("admin123456");
      const created = await client.query(
        `INSERT INTO auth.users (name, email, password_hash, must_change_password)
         VALUES ('EDM 管理员', 'admin@edm.local', $1, false)
         RETURNING id::text`,
        [hash],
      );
      userId = created.rows[0].id;
      console.log("✓ 创建演示账号 admin@edm.local / admin123456");
    } else {
      userId = existing.rows[0].id;
      console.log("= 演示账号已存在");
    }

    // 2. 项目
    const projectId = await findOrCreate(
      client,
      `INSERT INTO edm.projects (name, description, owner_id)
       VALUES ('Q3 活动邮件', '第三季度营销活动邮件', $1)`,
      [userId],
      "SELECT id FROM edm.projects WHERE name = 'Q3 活动邮件'",
      [],
    );
    await client.query(
      `INSERT INTO edm.project_members (project_id, user_id, role, invited_by)
       VALUES ($1, $2, 'admin', $2)
       ON CONFLICT DO NOTHING`,
      [projectId, userId],
    );

    // 3. 主题
    const topicId = await findOrCreate(
      client,
      `INSERT INTO edm.topics (project_id, name, purpose, created_by)
       VALUES ($1, '活动营销', '节假日与促销活动邮件', $2)`,
      [projectId, userId],
      "SELECT id FROM edm.topics WHERE project_id = $1 AND name = '活动营销'",
      [projectId],
    );
    await findOrCreate(
      client,
      `INSERT INTO edm.topics (project_id, name, purpose, created_by)
       VALUES ($1, '生命周期通知', '欢迎、支付、订单等系统通知', $2)`,
      [projectId, userId],
      "SELECT id FROM edm.topics WHERE project_id = $1 AND name = '生命周期通知'",
      [projectId],
    );

    // 4. 模板（若迁移后位于「默认主题」，挪到「活动营销」下）
    const tplFound = await client.query(
      `SELECT id, topic_id FROM edm.templates
        WHERE name = '新品首发通知'
          AND topic_id IN (SELECT id FROM edm.topics WHERE project_id = $1)`,
      [projectId],
    );
    let templateId: number;
    if (tplFound.rowCount === 1) {
      templateId = Number(tplFound.rows[0].id);
      if (Number(tplFound.rows[0].topic_id) !== topicId) {
        await client.query("UPDATE edm.templates SET topic_id = $2 WHERE id = $1", [
          templateId,
          topicId,
        ]);
      }
    } else {
      const created = await client.query(
        `INSERT INTO edm.templates (topic_id, name, purpose, tags, created_by)
         VALUES ($1, '新品首发通知', '新品上市时向活跃用户推送', ARRAY['活动','首发'], $2)
         RETURNING id`,
        [topicId, userId],
      );
      templateId = Number(created.rows[0].id);
    }

    // 5. 版本：一个 draft + 一个 saved（触发 lint/截图任务）
    const versions = await client.query(
      "SELECT count(*)::int AS c FROM edm.versions WHERE template_id = $1",
      [templateId],
    );
    if (versions.rows[0].c === 0) {
      await client.query(
        `INSERT INTO edm.versions (template_id, html, source, note, status, created_by)
         VALUES
           ($1, $2, $2, '初始实时迭代', 'draft', $3),
           ($1, $2, $2, '定稿：v1 上线', 'saved', $3)`,
        [templateId, SAMPLE_HTML, userId],
      );
      console.log("✓ 创建示例模板与两个版本（lint/截图任务将自动入队）");
    }

    console.log(
      `\n种子数据就绪：projectId=${projectId} topicId=${topicId} templateId=${templateId}`,
    );
  } finally {
    client.release();
    await servicePool.end();
  }
}

main().catch((err) => {
  console.error("seed 失败:", err);
  process.exit(1);
});
