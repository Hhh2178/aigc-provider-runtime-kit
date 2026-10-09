import { pathToFileURL } from "node:url";
import { readConfigFromEnv, type ControlCenterConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { createSecretCodec } from "../crypto.js";
import { createProviderRepository } from "../repository/providers.js";
import { createTaskRepository } from "../repository/tasks.js";
import { executeTask } from "./execute.js";
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
        await tasks.completeTask(task.id, { ...outcome.result, attempts: task.attempts + 1 });
        return "succeeded";
      }
      await tasks.failTask(task.id, { ...outcome.result, attempts: task.attempts + 1 });
      return "failed";
    } catch (error) {
      cleanupTaskSignal();
      const message = error instanceof Error ? error.message.slice(0, 600) : String(error);
      await tasks.failTask(task.id, { error: message, failureCategory: "executor_crash", runtimeStage: "failed" });
      return "failed";
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
