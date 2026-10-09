import type { ModelCapability } from "./types.js";

export type TaskCapability = ModelCapability;
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const TASK_TERMINAL_STATUSES = new Set<TaskStatus>(["succeeded", "failed", "cancelled"]);

export const TASK_CAPABILITIES = ["chat", "image", "video", "audio"] as const;

export interface TaskRecord {
  id: string;
  capability: TaskCapability;
  status: TaskStatus;
  providerId: string;
  modelRecordId?: string | undefined;
  protocol: string;
  claimedBy: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | undefined;
  finalizedAt?: number | undefined;
}

export interface TaskPatch {
  runtimeStage?: string;
  providerState?: string;
  progress?: string;
  waitReason?: string;
  message?: string;
  upstreamTaskId?: string;
  [key: string]: unknown;
}

/** Pure status machine shared by submit/worker/read paths. */
export function assertTransition(current: TaskStatus, next: TaskStatus) {
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    queued: ["queued", "running", "cancelled"],
    running: ["running", "succeeded", "failed", "cancelled"],
    succeeded: [],
    failed: [],
    cancelled: []
  };
  if (current === next) return;
  if (!allowed[current]?.includes(next)) {
    throw new Error(`无效任务状态迁移 ${current} -> ${next}`);
  }
}

export function isTerminal(status: TaskStatus) {
  return TASK_TERMINAL_STATUSES.has(status);
}

/**
 * Status projection for API consumers: degrades runtimeStage/providerState into
 * stable display fields so hosts can render progress without knowing internals.
 */
export function projectTaskStatus(task: {
  status: TaskStatus;
  result: Record<string, unknown>;
}) {
  const result = task.result ?? {};
  const runtimeStage = String(result.runtimeStage ?? "");
  const providerState = String(result.providerState ?? result.upstreamStatus ?? "");
  const message = String(result.message ?? result.error ?? "");
  const waitReason = String(result.waitReason ?? "");
  const urls = {
    imageUrls: stringList(result.materializedImageUrls) .length ? stringList(result.materializedImageUrls) : stringList(result.imageUrls),
    videoUrls: stringList(result.materializedVideoUrls).length ? stringList(result.materializedVideoUrls) : stringList(result.videoUrls),
    audioUrls: stringList(result.materializedAudioUrls).length ? stringList(result.materializedAudioUrls) : stringList(result.audioUrls),
    text: typeof result.text === "string" ? result.text : ""
  };
  let displayStatus: string = task.status;
  if (task.status === "queued") displayStatus = waitReason === "waiting_capability_window" ? "queued" : "queued";
  if (task.status === "running") {
    displayStatus = ["materializing", "materializing_partial", "succeeded"].includes(runtimeStage)
      ? "finalizing"
      : "executing";
  }
  return { displayStatus, runtimeStage, providerState, message, waitReason, urls };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
