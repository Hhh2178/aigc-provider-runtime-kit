import { RunningHubError } from "./error.js";

export interface RunningHubClientOptions {
  apiKey: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
  taskTimeoutMs?: number;
  /** Hard cap for upstream response bodies (default 16 MiB; poll payloads are small). */
  maxResponseBytes?: number;
  /** Polling schedule. Defaults to fixed-interval polling (legacy behavior). */
  polling?: RunningHubPollingOptions;
}

export interface RunningHubPollingOptions {
  strategy?: "fixed" | "exponential";
  intervalMs?: number;
  /** Cap for exponential backoff intervals (default 30000ms). */
  maxIntervalMs?: number;
  backoffFactor?: number;
}

export interface RunningHubNodeInfoItem {
  nodeId: string;
  fieldName: string;
  fieldValue: unknown;
}

export interface RunningHubRunInput {
  targetType: "app" | "workflow";
  runTargetId: string;
  appId?: string;
  workflowId?: string;
  nodeInfoList: RunningHubNodeInfoItem[];
  instanceType?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /**
   * Where URLs without a known media extension go. Default "video" keeps the
   * legacy behavior (they are appended to videoUrls only when no bucket has
   * output); "discard" drops them; "separate" returns them in `unclassifiedUrls`.
   */
  unclassifiedOutputs?: "video" | "discard" | "separate";
  signal?: AbortSignal;
  onHeartbeat?: (patch: Record<string, unknown>) => void | Promise<void>;
}

export interface RunningHubRunResult {
  adapter: "runninghub";
  upstreamTaskId: string;
  rhTargetType: "app" | "workflow";
  rhRunTargetId: string;
  raw: Record<string, unknown>;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  unclassifiedUrls?: string[];
}

export function createRunningHubClient(options: RunningHubClientOptions) {
  const apiKey = safeText(options.apiKey);
  const baseUrl = safeText(options.baseUrl).replace(/\/+$/, "");
  if (!apiKey) throw new RunningHubError("INVALID_CONFIGURATION", "RunningHub apiKey is required", { stage: "configuration" });
  if (!/^https?:\/\//i.test(baseUrl)) throw new RunningHubError("INVALID_CONFIGURATION", "RunningHub baseUrl must be an HTTP(S) URL", { stage: "configuration" });
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms))));

  async function runTask(input: RunningHubRunInput): Promise<RunningHubRunResult> {
    const targetType = input.targetType;
    const runTargetId = safeText(input.runTargetId);
    if (!runTargetId) throw new RunningHubError("INVALID_INPUT", targetType === "app" ? "RunningHub app runTargetId is required" : "RunningHub workflow runTargetId is required", { stage: "submit" });
    throwIfAborted(input.signal, "submit");

    const appId = safeText(input.appId || (targetType === "app" ? runTargetId : ""));
    const workflowId = safeText(input.workflowId || (targetType === "workflow" ? runTargetId : ""));
    const submitUrl = targetType === "app"
      ? `${baseUrl}/openapi/v2/run/ai-app/${encodeURIComponent(appId || runTargetId)}`
      : `${baseUrl}/openapi/v2/run/workflow/${encodeURIComponent(workflowId || runTargetId)}`;
    const queryUrl = `${baseUrl}/openapi/v2/query`;

    const submitBody = targetType === "app"
      ? {
          nodeInfoList: input.nodeInfoList,
          ...(safeText(input.instanceType) ? { instanceType: safeText(input.instanceType) } : {}),
          usePersonalQueue: "false"
        }
      : {
          apiKey,
          workflowId: workflowId || runTargetId,
          nodeInfoList: input.nodeInfoList,
          ...(safeText(input.instanceType) ? { instanceType: safeText(input.instanceType) } : {})
        };

    const submitRaw = await postJson(fetcher, submitUrl, apiKey, submitBody, "submit", options.requestTimeoutMs, input.signal);
    const submitData = plainObject(targetType === "app" ? plainObject(submitRaw.data) : submitRaw.data);
    const upstreamTaskId = safeText(submitData.taskId || submitData.id || submitRaw.taskId || submitRaw.id);
    const upstreamCode = Number(submitRaw.code);
    if ((Number.isFinite(upstreamCode) && upstreamCode !== 0) || !upstreamTaskId) {
      throw new RunningHubError("UPSTREAM_REJECTED", safeText(submitData.msg || submitRaw.message || submitRaw.msg, "RunningHub did not return a valid task id"), { stage: "submit" });
    }

    await input.onHeartbeat?.({
      upstreamTaskId,
      upstreamStatus: "submitted",
      progress: "5%",
      rhTargetType: targetType,
      rhRunTargetId: runTargetId
    });

    const startedAt = Date.now();
    const timeoutMs = normalizeTimeout(input.timeoutMs ?? options.taskTimeoutMs, 30 * 60 * 1000);
    const polling = resolvePolling(options.polling, input.pollIntervalMs);
    let pollAttempt = 0;
    for (;;) {
      throwIfAborted(input.signal, "poll");
      if (Date.now() - startedAt >= timeoutMs) throw taskTimeout(upstreamTaskId);
      await wait(nextPollDelay(polling, pollAttempt));
      pollAttempt += 1;
      throwIfAborted(input.signal, "poll");
      if (Date.now() - startedAt >= timeoutMs) throw taskTimeout(upstreamTaskId);
      const pollRaw = await postJson(fetcher, queryUrl, apiKey, { taskId: upstreamTaskId }, "poll", options.requestTimeoutMs, input.signal, options.maxResponseBytes);
      const pollCode = Number(pollRaw.code);
      if (Number.isFinite(pollCode) && pollCode !== 0) {
        throw new RunningHubError("UPSTREAM_REJECTED", safeText(pollRaw.msg || pollRaw.message, `RunningHub poll rejected with code ${pollCode}`), { stage: "poll" });
      }
      const status = safeText(pollRaw.status || plainObject(pollRaw.data).status).toUpperCase();
      const message = safeText(pollRaw.errorMessage || pollRaw.msg || pollRaw.message || plainObject(pollRaw.data).message);
      await input.onHeartbeat?.({
        upstreamTaskId,
        upstreamStatus: status,
        upstreamMessage: message,
        progress: ["QUEUED", "PENDING", "WAITING"].includes(status) ? "5%" : "45%",
        rhTargetType: targetType,
        rhRunTargetId: runTargetId
      });

      if (["RUNNING", "PENDING", "QUEUED", "WAITING"].includes(status)) continue;
      if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status)) {
        throw new RunningHubError("TASK_FAILED", message || `RunningHub task failed: ${upstreamTaskId}`, { stage: "poll" });
      }

      const urls = extractRunningHubOutputUrls(targetType === "app" ? pollRaw.results || pollRaw.data || pollRaw : pollRaw.data || pollRaw, {
        ...(input.unclassifiedOutputs && input.unclassifiedOutputs !== "video" ? { unclassifiedHandling: input.unclassifiedOutputs } : {})
      });
      const completed = ["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"].includes(status);
      const hasOutput = urls.imageUrls.length > 0 || urls.videoUrls.length > 0 || urls.audioUrls.length > 0 || (urls.unclassifiedUrls?.length ?? 0) > 0;
      if (!completed && !hasOutput) {
        throw new RunningHubError("UNKNOWN_TASK_STATUS", `RunningHub returned unknown task status: ${status || "<empty>"}`, { stage: "poll" });
      }
      if (!hasOutput) {
        throw new RunningHubError("MISSING_OUTPUT", message || "RunningHub task completed without usable outputs", { stage: "result" });
      }
      return {
        adapter: "runninghub",
        upstreamTaskId,
        rhTargetType: targetType,
        rhRunTargetId: runTargetId,
        raw: pollRaw,
        ...urls
      };
    }
  }

  return { runTask };
}

function resolvePolling(pollingOptions: RunningHubPollingOptions | undefined, legacyPollIntervalMs: number | undefined): RunningHubPollingOptions {
  const polling = pollingOptions ?? {};
  const intervalMs = polling.intervalMs ?? legacyPollIntervalMs;
  return {
    ...polling,
    ...(intervalMs !== undefined ? { intervalMs } : {})
  };
}

function nextPollDelay(polling: RunningHubPollingOptions, attempt: number) {
  const base = Math.max(1000, Number(polling.intervalMs || 5000));
  if (polling.strategy !== "exponential") return base;
  const factor = Number.isFinite(Number(polling.backoffFactor)) ? Math.max(1, Number(polling.backoffFactor)) : 2;
  const maxIntervalMs = Number.isFinite(Number(polling.maxIntervalMs)) ? Math.max(base, Number(polling.maxIntervalMs)) : 30000;
  return Math.min(maxIntervalMs, Math.floor(base * Math.pow(factor, attempt)));
}

async function postJson(fetcher: typeof fetch, url: string, apiKey: string, body: Record<string, unknown>, stage: "submit" | "poll", timeoutMsValue?: number, signal?: AbortSignal, maxResponseBytesValue?: number) {
  const timeoutSignal = AbortSignal.timeout(normalizeTimeout(timeoutMsValue, 120000));
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
      signal: requestSignal
    });
  } catch (cause) {
    if (signal?.aborted) throw new RunningHubError("REQUEST_ABORTED", `RunningHub ${stage} aborted`, { stage, cause });
    throw new RunningHubError("REQUEST_FAILED", `RunningHub ${stage} request failed`, { stage, retryable: true, cause });
  }
  const text = await readBoundedText(response, maxResponseBytesValue);
  if (!response.ok) throw new RunningHubError("REQUEST_FAILED", `RunningHub ${stage} failed ${response.status}: ${text.slice(0, 500)}`, { stage, status: response.status, retryable: response.status === 429 || response.status >= 500 });
  try {
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    throw new RunningHubError("INVALID_RESPONSE", `RunningHub ${stage} returned invalid JSON`, { stage });
  }
}

export interface RunningHubOutputExtractionOptions {
  unclassifiedHandling?: "video" | "discard" | "separate";
}

export function extractRunningHubOutputUrls(value: unknown, options: RunningHubOutputExtractionOptions = {}) {
  const unclassifiedHandling = options.unclassifiedHandling ?? "video";
  const urls = collectRunningHubUrls(value);
  const imageUrls = urls.filter((url) => /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i.test(url));
  const videoUrls = urls.filter((url) => /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(url));
  const audioUrls = urls.filter((url) => /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(url));
  const uncategorized = urls.filter((url) => !imageUrls.includes(url) && !videoUrls.includes(url) && !audioUrls.includes(url));
  if (uncategorized.length > 0 && unclassifiedHandling !== "discard") {
    const nothingCategorized = imageUrls.length === 0 && videoUrls.length === 0 && audioUrls.length === 0;
    if (unclassifiedHandling === "separate") return { imageUrls, videoUrls, audioUrls, unclassifiedUrls: uncategorized };
    if (nothingCategorized) videoUrls.push(...uncategorized);
  }
  return { imageUrls, videoUrls, audioUrls };
}

const RH_MAX_BODY_BYTES = 16 * 1024 * 1024;

async function readBoundedText(response: Response, maxBytesValue: number | undefined) {
  const maxBytes = Number.isFinite(Number(maxBytesValue)) && Number(maxBytesValue) > 0 ? Math.floor(Number(maxBytesValue)) : RH_MAX_BODY_BYTES;
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const bytes: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
    received += chunk.byteLength;
    if (received > maxBytes) {
      void reader.cancel().catch(() => {});
      throw new RunningHubError("INVALID_RESPONSE", `RunningHub response body exceeds ${maxBytes} bytes`, { stage: "poll" });
    }
    bytes.push(chunk);
  }
  let text = "";
  const decoder = new TextDecoder();
  for (const chunk of bytes) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return text;
}

function collectRunningHubUrls(value: unknown, seen = new Set<string>()): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^https?:\/\//i.test(text) || seen.has(text)) return [];
    seen.add(text);
    return [text];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectRunningHubUrls(item, seen));
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return [
      ...collectRunningHubUrls(row.fileUrl, seen),
      ...collectRunningHubUrls(row.url, seen),
      ...collectRunningHubUrls(row.downloadUrl, seen),
      ...collectRunningHubUrls(row.previewUrl, seen),
      ...collectRunningHubUrls(row.outputs, seen),
      ...collectRunningHubUrls(row.results, seen),
      ...collectRunningHubUrls(row.files, seen),
      ...collectRunningHubUrls(row.data, seen),
      ...collectRunningHubUrls(row.result, seen)
    ];
  }
  return [];
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeText(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function normalizeTimeout(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value as number));
}

function throwIfAborted(signal: AbortSignal | undefined, stage: "submit" | "poll") {
  if (signal?.aborted) throw new RunningHubError("REQUEST_ABORTED", `RunningHub ${stage} aborted`, { stage, cause: signal.reason });
}

function taskTimeout(upstreamTaskId: string) {
  return new RunningHubError("TASK_TIMEOUT", `RunningHub poll timeout: ${upstreamTaskId}`, { stage: "poll", retryable: true });
}
