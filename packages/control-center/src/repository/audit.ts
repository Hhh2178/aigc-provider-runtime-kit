import { randomUUID } from "node:crypto";
import type { SqlExecutor } from "../db.js";

export interface AuditActor {
  id: string;
  email: string;
  name?: string;
  role: string;
}

export interface AuditRequestContext {
  requestId: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  startedAt: number;
}

export function createAuditRepository(executor: SqlExecutor) {
  return async function appendAudit(
    actor: AuditActor,
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
    requestContext: AuditRequestContext,
  ) {
    const id = `audit-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    await executor.query(
      `insert into cc_audit_logs (id, actor_id, actor_email, action, target_type, target_id, summary, ip, user_agent, request_id, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
      [
        id,
        actor.id || null,
        actor.email || "",
        action,
        targetType,
        targetId,
        summary,
        requestContext.ip || "",
        requestContext.userAgent || "",
        requestContext.requestId || ""
      ]
    );
  };
}

export function createAuditReader(executor: SqlExecutor) {
  return async function readAuditLogs(options: { limit?: number; action?: string } = {}): Promise<Array<Record<string, unknown>>> {
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    if (options.action) {
      const result = await executor.query(
        "select * from cc_audit_logs where action = $2 order by created_at desc limit $1",
        [limit, String(options.action)]
      );
      return result.rows;
    }
    const result = await executor.query("select * from cc_audit_logs order by created_at desc limit $1", [limit]);
    return result.rows;
  };
}
