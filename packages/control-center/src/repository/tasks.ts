import type { SqlExecutor } from "../db.js";
import {
  assertTransition,
  type TaskCapability,
  type TaskPatch,
  type TaskRecord,
  type TaskStatus
} from "../domain/task-machine.js";
import { randomBytes, randomUUID } from "node:crypto";
import { dateToMillis, plainObject, safeText } from "../util.js";

export interface EnqueueTaskInput {
  capability: TaskCapability;
  providerId: string;
  modelRecordId?: string;
  protocol: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface TaskRepository {
  enqueueTask(input: EnqueueTaskInput): Promise<TaskRecord>;
  findTaskByIdempotencyKey(idempotencyKey: string): Promise<TaskRecord | null>;
  findTaskById(taskId: string): Promise<TaskRecord | null>;
  claimNextTask(workerId: string): Promise<TaskRecord | null>;
  patchTaskResult(taskId: string, patch: TaskPatch): Promise<void>;
  completeTask(taskId: string, result: Record<string, unknown>): Promise<TaskRecord>;
  failTask(taskId: string, result: Record<string, unknown>): Promise<TaskRecord>;
  cancelTask(taskId: string, message: string): Promise<TaskRecord>;
  appendTaskEvent(taskId: string, type: string, detail?: Record<string, unknown>): Promise<void>;
  readTaskEvents(taskId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  listTasks(options: { status?: string; capability?: string; limit?: number }): Promise<TaskRecord[]>;
  requeueStaleRunningTasks(staleMinutes: number): Promise<number>;
}

const TASK_SELECT = `
select id, tenant_id, capability, status, provider_id, model_record_id, protocol, claimed_by, attempts, payload, result, created_at, updated_at, started_at, finalized_at
from cc_tasks`;

export function createTaskRepository(executor: SqlExecutor, tenantId: string): TaskRepository {
  function fromRow(row: Record<string, unknown>): TaskRecord {
    return {
      id: String(row.id ?? ""),
      capability: safeText(row.capability) as TaskCapability,
      status: safeText(row.status, "queued") as TaskStatus,
      providerId: String(row.provider_id ?? ""),
      modelRecordId: (String(row.model_record_id ?? "") || undefined) as string | undefined,
      protocol: String(row.protocol ?? ""),
      claimedBy: String(row.claimed_by ?? ""),
      attempts: Number(row.attempts ?? 0),
      payload: plainObject(row.payload),
      result: plainObject(row.result),
      createdAt: dateToMillis(row.created_at),
      updatedAt: dateToMillis(row.updated_at),
      startedAt: row.started_at ? dateToMillis(row.started_at) : undefined,
      finalizedAt: row.finalized_at ? dateToMillis(row.finalized_at) : undefined
    };
  }

  return {
    async enqueueTask(input) {
      const id = `task-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      if (input.idempotencyKey) {
        const existing = await this.findTaskByIdempotencyKey(input.idempotencyKey);
        if (existing) return existing;
      }
      let result: Record<string, unknown> = {};
      if (input.idempotencyKey) result = { idempotencyKey: input.idempotencyKey, idempotencyScope: tenantId };
      const inserted = await executor.query(
        `insert into cc_tasks (id, tenant_id, capability, status, provider_id, model_record_id, protocol, payload, result)
         values ($1,$2,$3,'queued',$4,$5,$6,$7::jsonb,$8::jsonb)
         returning *`,
        [
          id,
          tenantId,
          input.capability,
          input.providerId,
          input.modelRecordId || null,
          input.protocol,
          JSON.stringify(input.payload),
          JSON.stringify(result)
        ]
      );
      await writeEvent(id, "task.created", { capability: input.capability, providerId: input.providerId });
      return fromRow(inserted.rows[0] ?? {});
    },
    async findTaskByIdempotencyKey(idempotencyKey) {
      const result = await executor.query(
        `${TASK_SELECT} where result->>'idempotencyKey' = $1 and result->>'idempotencyScope' = $2 limit 1`,
        [idempotencyKey, tenantId]
      );
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    },
    async findTaskById(taskId) {
      const result = await executor.query(`${TASK_SELECT} where id = $1 limit 1`, [safeText(taskId)]);
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    },
    async claimNextTask(workerId) {
      // Atomic queue claim: SKIP LOCKED keeps concurrent workers from colliding.
      const result = await executor.query(
        `update cc_tasks set status = 'running', claimed_by = $2, attempts = attempts + 1, started_at = now(), updated_at = now()
         where id = (
           select id from cc_tasks
           where tenant_id = $1 and status = 'queued'
           order by created_at asc, id asc
           for update skip locked
           limit 1
         )
         returning *`,
        [tenantId, safeText(workerId) || `worker-unknown`]
      );
      const task = result.rows[0] ? fromRow(result.rows[0]) : null;
      if (task) await writeEvent(task.id, "task.claimed", { workerId: task.claimedBy });
      return task;
    },
    async patchTaskResult(taskId, patch) {
      const result = await executor.query(
        `update cc_tasks set result = result || $2::jsonb, updated_at = now() where id = $1 returning status`,
        [safeText(taskId), JSON.stringify(patch)]
      );
      const status = result.rows[0] ? String(result.rows[0].status) : "";
      if (status === "failed" || status === "cancelled") return;
      await writeEvent(safeText(taskId), "task.heartbeat", patch);
    },
    async completeTask(taskId, taskResult) {
      const current = await this.findTaskById(taskId);
      if (!current) throw new Error("任务不存在");
      assertTransition(current.status, "succeeded");
      const result = await executor.query(
        `update cc_tasks set status = 'succeeded', result = $2::jsonb, updated_at = now(), finalized_at = now()
         where id = $1 and status in ('queued','running')
         returning *`,
        [taskId, JSON.stringify(taskResult)]
      );
      await writeEvent(taskId, "task.succeeded", pickSummary(taskResult));
      return result.rows[0] ? fromRow(result.rows[0]) : current;
    },
    async failTask(taskId, taskResult) {
      const current = await this.findTaskById(taskId);
      if (!current) throw new Error("任务不存在");
      assertTransition(current.status, "failed");
      const result = await executor.query(
        `update cc_tasks set status = 'failed', result = $2::jsonb, updated_at = now(), finalized_at = now()
         where id = $1 and status in ('queued','running')
         returning *`,
        [taskId, JSON.stringify(taskResult)]
      );
      await writeEvent(taskId, "task.failed", pickSummary(taskResult));
      return result.rows[0] ? fromRow(result.rows[0]) : current;
    },
    async cancelTask(taskId, message) {
      const current = await this.findTaskById(taskId);
      if (!current) throw new Error("任务不存在");
      assertTransition(current.status, "cancelled");
      const result = await executor.query(
        `update cc_tasks set status = 'cancelled', result = result || $2::jsonb, updated_at = now(), finalized_at = now()
         where id = $1 and status in ('queued', 'running')
         returning *`,
        [taskId, JSON.stringify({ cancelled: true, cancellationMessage: safeText(message, "任务已取消") })]
      );
      await writeEvent(taskId, "task.cancelled", { message: safeText(message) });
      return result.rows[0] ? fromRow(result.rows[0]) : current;
    },
    async appendTaskEvent(taskId, type, detail = {}) {
      const id = `evt-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
      await executor.query(
        "insert into cc_task_events (id, task_id, type, detail) values ($1,$2,$3,$4::jsonb)",
        [id, safeText(taskId), safeText(type), JSON.stringify(detail)]
      );
    },
    async readTaskEvents(taskId, limit = 30) {
      const result = await executor.query(
        "select * from cc_task_events where task_id = $1 order by created_at desc limit $2",
        [safeText(taskId), Math.max(1, Math.min(200, limit))]
      );
      return result.rows;
    },
    async listTasks(options = {}) {
      const conditions: string[] = ["tenant_id = $1"];
      const params: unknown[] = [tenantId];
      if (options.status) {
        params.push(safeText(options.status));
        conditions.push(`status = $${params.length}`);
      }
      if (options.capability) {
        params.push(safeText(options.capability));
        conditions.push(`capability = $${params.length}`);
      }
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
      params.push(limit);
      const result = await executor.query(
        `${TASK_SELECT} where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
        params
      );
      return result.rows.map(fromRow);
    },
    async requeueStaleRunningTasks(staleMinutes) {
      const result = await executor.query(
        `update cc_tasks set status = 'queued', claimed_by = '', result = result || $2::jsonb, updated_at = now()
         where tenant_id = $1 and status = 'running' and updated_at < now() - ($3 || ' minutes')::interval
         returning id`,
        [tenantId, JSON.stringify({ requeued: "stale" }), String(Math.max(1, staleMinutes))]
      );
      for (const row of result.rows) {
        await writeEvent(String(row.id), "task.requeued", { reason: "stale_running" });
      }
      return result.rows.length;
    }
  };

  async function writeEvent(taskId: string, type: string, detail: Record<string, unknown>) {
    const id = `evt-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    await executor.query(
      "insert into cc_task_events (id, task_id, type, detail) values ($1,$2,$3,$4::jsonb)",
      [id, safeText(taskId), safeText(type), JSON.stringify(detail)]
    );
  }

  function pickSummary(taskResult: Record<string, unknown>) {
    return {
      runtimeStage: safeText(taskResult.runtimeStage),
      providerState: safeText(taskResult.providerState),
      error: safeText(taskResult.error),
      tries: 1
    };
  }
}
