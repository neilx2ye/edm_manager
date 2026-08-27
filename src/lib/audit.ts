export interface AuditEntry {
  projectId: number | null;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  payload?: Record<string, unknown>;
}

/**
 * 审计日志功能已移除（节省数据库空间，见 migrations/0011）。
 * 保留此空实现以兼容各处调用；不执行任何数据库写入。
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  void entry;
}
