BEGIN;

-- 修复：INSERT ... RETURNING 会再应用 SELECT 策略；策略若经 template_project(id)
-- 自引用查询 templates，新行在语句快照中不可见，导致误拒。
-- 改为直接使用行上的 topic_id 列经 topics 解析项目。

DROP POLICY IF EXISTS templates_select ON edm.templates;
DROP POLICY IF EXISTS templates_insert ON edm.templates;
DROP POLICY IF EXISTS templates_update ON edm.templates;
DROP POLICY IF EXISTS templates_delete ON edm.templates;

CREATE POLICY templates_select ON edm.templates FOR SELECT TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'viewer'));
CREATE POLICY templates_insert ON edm.templates FOR INSERT TO edm_app
  WITH CHECK (edm.is_member(edm.topic_project(topic_id), 'editor'));
CREATE POLICY templates_update ON edm.templates FOR UPDATE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'editor'))
  WITH CHECK (edm.is_member(edm.topic_project(topic_id), 'editor'));
CREATE POLICY templates_delete ON edm.templates FOR DELETE TO edm_app
  USING (edm.is_member(edm.topic_project(topic_id), 'admin'));

COMMIT;
