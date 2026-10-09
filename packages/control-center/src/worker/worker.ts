import { pathToFileURL } from "node:url";
import { readConfigFromEnv, type ControlCenterConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { createSecretCodec } from "../crypto.js";
import { createProviderRepository } from "../repository/providers.js";
import { createTaskRepository } from "../repository/tasks.js";
import { executeTask } from "./execute.js";
import { deliverTaskCallback } from "./callback.js";
import { materializeTaskOutputs } from "./materialize.js";
import { createPricingRepository } from "../repository/pricing.js";
import type { TaskRecord } from "../domain/task-machine.js";

export interface TaskWorkerOptions {
  config: ControlCenterConfig;
  /** Concurrent claim slot count. */
  concurrency?: number;
  /** Poll interval between queue scans when idle. */
  idleIntervalMs?: number;
  /** Running tasks older than this are re-queued (crash recovery). */
  staleMinutes?: number;
  maxHeartbeatRowsPerTask?: number;
}

export interface TaskWorker {
  start(): Promise<void>;
  close(): Promise<void>;
  runOnce(): Promise<ClaimOutcome>;
}

export type ClaimOutcome = { claimed: false } | { claimed: true; taskId: string; status: "succeeded" | "failed" };

export function createTaskWorker(options: TaskWorkerOptions): TaskWorker {
  const { config } = options;
  const concurrency = Math.max(1, Math.floor(Number(options.concurrency ?? config.workerConcurrency ?? 4)));
  const idleIntervalMs = Math.max(250, Number(options.idleIntervalMs ?? 1500));
  const staleMinutes = Math.max(1, Math.floor(Number(options.staleMinutes ?? 30)));

  const database = createDatabase(config.databaseUrl, () => {});
  const codec = createSecretCodec(config.secretKey);
  const providers = createProviderRepository(database.pool, codec, config.tenantId);
  const tasks = createTaskRepository(database.pool, config.tenantId);
  const costs = createPricingRepository(database.pool, config.tenantId);

  let stopping = false;
  let lastReaperAt = 0;

  const worker: TaskWorker = {
    async start() {
      await database.migrate();
      config.log(`task worker listening on tenant ${config.tenantId} with ${concurrency} slots`);
      let idleRuns = 0;
      while (!stopping) {
        if (idleRuns > 0 && idleRuns % 40 === 0) await requeueStale(staleMinutes);
        const slots = Array.from({ length: concurrency }, () => claimAndExecute());
        const outcomes = await Promise.all(slots);
        const claimedAny = outcomes.some((outcome) => outcome);
        if (!claimedAny) {
          idleRuns += 1;
          await sleep(idleIntervalMs);
        } else {
          idleRuns = 0;
        }
      }
    },
    async close() {
      stopping = true;
      await database.close();
    },
    async runOnce() {
      const claimed = await claimNext();
      if (!claimed) return { claimed: false } as ClaimOutcome;
      const status = await runTask(claimed);
      return { claimed: true, taskId: claimed.id, status } as ClaimOutcome;
    }
  };

  async function claimNext(): Promise<TaskRecord | null> {
    return tasks.claimNextTask(`w-${process.pid}-${Date.now().toString(36)}`);
  }

  async function runTask(task: TaskRecord): Promise<"succeeded" | "failed"> {
    try {
      const providerRecord = await providers.findProviderRecordById(task.providerId);
      if (!providerRecord) {
        await tasks.failTask(task.id, { error: `Provider 不存在: ${task.providerId}`, failureCategory: "provider_missing", runtimeStage: "failed" });
        return "failed";
      }
      const model = task.payload.modelRecordId
        ? (await providers.findModelRecordById(String(task.payload.modelRecordId)))
        : null;
      const outcome = await executeTask(
        {
          task,
          model: model
            ? {
                id: model.id,
                modelId: model.modelId,
                capability: model.capability,
                advancedConfig: Array.isArray(model.advancedConfig) ? {} : model.advancedConfig as Record<string, unknown>
              }
            : null,
          provider: {
            id: providerRecord.id,
            protocol: providerRecord.protocol ?? "openai",
            baseUrl: providerRecord.baseUrl,
            apiKeyPlain: decrypt(providerRecord.apiKey),
            rhKeyPool: (providerRecord.rhKeyPool ?? []).map((item) => ({
              id: item.id,
              apiKeyPlain: decrypt(item.apiKey ?? ""),
              isDefault: item.isDefault === true,
              enabled: item.enabled
            }))
          },
          onHeartbeat: async (patch) => {
            await tasks.patchTaskResult(task.id, patch);
          },
          signal: createTaskSignal(Number(task.payload.timeoutMs) || 15 * 60_000).signal
        },
        codec
      );
      cleanupTaskSignal();
      if (outcome.status === "succeeded") {
        let finalResult: Record<string, unknown> = { ...outcome.result, attempts: task.attempts + 1 };
        if (config.storageDir) {
          try {
            const materialized = await materializeTaskOutputs(finalResult, { storageDir: config.storageDir, taskId: task.id });
            finalResult = { ...materialized.result, attempts: task.attempts + 1 };
            if (materialized.warnings.length > 0) finalResult.materializeWarnings = materialized.warnings;
          } catch (error) {
            config.warn(`materialization skipped for ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        try {
          const cost = await costs.recordTaskCost({
            id: task.id,
            providerId: task.providerId,
            modelRecordId: task.modelRecordId,
            payload: task.payload,
            result: finalResult
          });
          if (cost) {
            finalResult.cost = { amount: cost.amount, quantity: cost.quantity, billedSource: cost.billedSource, currency: cost.currency, costId: cost.costId };
          }
        } catch (error) {
          config.warn(`cost recording failed for ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
        await tasks.completeTask(task.id, finalResult);
        await notifyHost(task, "succeeded", finalResult);
        return "succeeded";
      }
      await tasks.failTask(task.id, { ...outcome.result, attempts: task.attempts + 1 });
      await notifyHost(task, "failed", outcome.result);
      return "failed";
    } catch (error) {
      cleanupTaskSignal();
      const message = error instanceof Error ? error.message.slice(0, 600) : String(error);
      const failure = { error: message, failureCategory: "executor_crash", runtimeStage: "failed" };
      await tasks.failTask(task.id, failure);
      await notifyHost(task, "failed", failure);
      return "failed";
    }
  }

  async function notifyHost(task: TaskRecord, status: "succeeded" | "failed", result: Record<string, unknown>) {
    const delivery = await deliverTaskCallback(task.payload.callbackUrl, {
      taskId: task.id,
      status,
      capability: task.capability,
      providerId: task.providerId,
      ...(task.modelRecordId ? { modelRecordId: task.modelRecordId } : {}),
      result
    });
    if (delivery.attempted && !delivery.delivered) {
      config.warn(`task ${task.id} callback delivery failed: ${delivery.error ?? delivery.status ?? "unknown"}`);
    }
  }

  function decrypt(value?: string) {
    return codec.decrypt(value ?? "");
  }

  async function requeueStale(minutes: number): Promise<number> {
    const now = Date.now();
    if (now - lastReaperAt < 60_000) return 0;
    lastReaperAt = now;
    try {
      const requeued = await tasks.requeueStaleRunningTasks(minutes);
      if (requeued > 0) config.warn(`requeued ${requeued} stale running task(s)`);
      return requeued;
    } catch (error) {
      config.warn(`stale reaper failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  async function claimAndExecute(): Promise<boolean> {
    const claimed = await claimNext();
    if (!claimed) return false;
    await runTask(claimed);
    return true;
  }

  let signalCleanup: (() => void) | null = null;

  function createTaskSignal(timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`任务执行超时(${Math.round(timeoutMs / 1000)}s)`)), Math.max(1000, timeoutMs));
    signalCleanup = () => clearTimeout(timer);
    return controller;
  }

  function cleanupTaskSignal() {
    signalCleanup?.();
    signalCleanup = null;
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return worker;
}

export async function startTaskWorkerFromEnv() {
  const config = readConfigFromEnv();
  if (!config.databaseUrl) throw new Error("CC_DATABASE_URL is required to run the task worker");
  const worker = createTaskWorker({ config });
  await worker.start();
}

export function isWorkerEntrypoint() {
  return process.argv[1] === pathToFileURL(import.meta.url).href || process.argv[1]?.endsWith("worker.js");
}

if (isWorkerEntrypoint()) {
  startTaskWorkerFromEnv().catch((error) => {
    console.error("task worker failed to start:", error);
    process.exit(1);
  });
}
