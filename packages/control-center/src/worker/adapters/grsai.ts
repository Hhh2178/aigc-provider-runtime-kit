/**
 * GRSAI image client ported from the production adapter
 * (`xinghuan/apps/api/src/grsai-image-adapter.ts`), behavior-identical:
 * submit -> immediate result or pending task -> poll with gateway retries,
 * SSE-style `data:` body tolerance, and explicit missing-image errors.
 */

export interface GrsaiImageClientOptions {
  apiKey: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface GrsaiImageGenerateInput {
  modelId: string;
  prompt: string;
  aspectRatio?: string;
  size?: string;
  images?: string[];
  submitPath?: string;
  pollPath?: string;
  onHeartbeat?: (patch: Record<string, unknown>) => void | Promise<void>;
}

export interface GrsaiImageGenerateResult {
  imageUrls: string[];
  taskId?: string;
  raw: Record<string, unknown>;
}

interface GrsaiHttpError extends Error {
  status?: number;
}

export function createGrsaiImageClient(options: GrsaiImageClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 1500);
  const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Math.max(1000, options.timeoutMs)
    : undefined;

  return {
    async generate(input: GrsaiImageGenerateInput): Promise<GrsaiImageGenerateResult> {
      const submitPath = resolveGrsaiSubmitPath(input.submitPath, input.modelId);
      const pollPath = resolveGrsaiPollPath(input.pollPath);
      const submit = await requestJson(fetcher, `${baseUrl}${submitPath}`, options.apiKey, {
        model: input.modelId,
        prompt: input.prompt,
        webHook: "-1",
        ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
        ...(input.size ? { size: input.size } : {}),
        ...(input.images && input.images.length > 0 ? { urls: input.images } : {})
      });

      const submitUrls = extractImageUrls(submit.payload);
      if (submitUrls.length > 0) {
        return { imageUrls: submitUrls, taskId: readString(readTaskId(submit.payload)), raw: submit.payload };
      }

      const submitState = normalizeState(submit.payload);
      await input.onHeartbeat?.({
        upstreamTaskId: submitState.taskId || "",
        upstreamStatus: submitState.rawStatus || "submitted",
        runtimeStage: submitState.kind === "pending" ? "polling" : "running"
      });
      if (submitState.kind === "failed") throw new Error(submitState.errorMessage);
      if (submitState.kind === "success") throw new Error(buildMissingImageResultError(submit.payload, submitState));
      if (!submitState.taskId) throw new Error("GRSAI 未返回任务 ID");

      const startedAt = Date.now();
      let gatewayRetryCount = 0;
      const maxGatewayRetries = 4;
      for (;;) {
        if (typeof timeoutMs === "number" && Date.now() - startedAt > timeoutMs) throw new Error("GRSAI 图像生成轮询超时");
        if (pollIntervalMs > 0) await wait(pollIntervalMs);

        let polled: { payload: Record<string, unknown> };
        try {
          polled = await pollJson(fetcher, baseUrl, options.apiKey, submitState.taskId, pollPath);
          gatewayRetryCount = 0;
        } catch (error) {
          if (isRetryablePollGatewayFailure(error) && gatewayRetryCount < maxGatewayRetries) {
            gatewayRetryCount += 1;
            await wait(1200 * gatewayRetryCount);
            continue;
          }
          throw error;
        }
        const imageUrls = extractImageUrls(polled.payload);
        if (imageUrls.length > 0) return { imageUrls, taskId: submitState.taskId, raw: polled.payload };
        const state = normalizeState(polled.payload);
        await input.onHeartbeat?.({
          upstreamTaskId: state.taskId || submitState.taskId,
          upstreamStatus: state.rawStatus || "pending",
          runtimeStage: "polling"
        });
        if (state.kind === "failed") throw new Error(state.errorMessage);
        if (state.kind === "success") throw new Error(buildMissingImageResultError(polled.payload, state));
      }
    }
  };
}

async function requestJson(fetcher: typeof fetch, url: string, apiKey: string, body: Record<string, unknown>) {
  const response = await fetcher(url, { method: "POST", headers: jsonHeaders(apiKey), body: JSON.stringify(body) });
  const parsed = await readJson(response);
  if (!response.ok) throw createGrsaiHttpError(response.status, parsed);
  return { response, payload: parsed.payload };
}

async function pollJson(fetcher: typeof fetch, baseUrl: string, apiKey: string, taskId: string, pollPath: string) {
  const postResponse = await fetcher(`${baseUrl}${pollPath}`, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ taskId, id: taskId })
  });
  if (postResponse.status === 405) {
    const fallback = await fetcher(`${baseUrl}${pollPath}?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: jsonHeaders(apiKey)
    });
    const parsed = await readJson(fallback);
    if (!fallback.ok) throw createGrsaiHttpError(fallback.status, parsed);
    return { response: fallback, payload: parsed.payload };
  }
  const parsed = await readJson(postResponse);
  if (!postResponse.ok) throw createGrsaiHttpError(postResponse.status, parsed);
  return { response: postResponse, payload: parsed.payload };
}

function normalizeState(payload: Record<string, unknown>) {
  const envelope = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload;
  const code = typeof payload.code === "number" ? payload.code : typeof envelope.code === "number" ? envelope.code : undefined;
  const taskId = readString(readTaskId(payload));
  const rawStatus = readString(envelope.status || envelope.state || envelope.progressState || payload.status || payload.state || payload.progressState);
  const status = rawStatus.toLowerCase();
  const errorMessage = extractErrorMessage(payload);
  const successSignal = ["success", "succeeded", "completed", "done", "ok"].includes(errorMessage.toLowerCase());

  if (code !== undefined && code !== 0) {
    return { kind: "failed" as const, errorMessage: errorMessage || `Provider request failed with code ${code}`, taskId, rawStatus };
  }
  if (["failed", "error", "cancelled", "canceled"].includes(status)) {
    return { kind: "failed" as const, errorMessage: errorMessage || "Provider request failed", taskId, rawStatus };
  }
  if (["succeeded", "success", "completed", "done"].includes(status)) {
    return { kind: "success" as const, taskId, rawStatus };
  }
  if (errorMessage && !successSignal && !taskId) {
    return { kind: "failed" as const, errorMessage, taskId, rawStatus };
  }
  return { kind: "pending" as const, taskId, rawStatus };
}

function isRetryablePollGatewayFailure(error: unknown) {
  const status = readErrorHttpStatus(error);
  if (status === 502 || status === 503 || status === 504) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /502|503|504|bad gateway|fetch failed/i.test(message);
}

function createGrsaiHttpError(status: number, responseBody: { payload: Record<string, unknown>; bodySnippet: string }) {
  const message = extractErrorMessage(responseBody.payload) || responseBody.bodySnippet || `HTTP ${status}`;
  const error = new Error(message) as GrsaiHttpError;
  error.name = "GrsaiHttpError";
  error.status = status;
  return error;
}

function readErrorHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const directStatus = Number((error as { status?: unknown }).status);
  if (Number.isInteger(directStatus) && directStatus >= 100 && directStatus <= 599) return directStatus;
  return undefined;
}

function readTaskId(payload: Record<string, unknown>) {
  const envelope = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload;
  return envelope.id || envelope.taskId || envelope.task_id || payload.id || payload.taskId || payload.task_id;
}

function extractImageUrls(payload: Record<string, unknown>) {
  const pool = [payload, payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : null]
    .filter(Boolean) as Record<string, unknown>[];
  const urls: string[] = [];
  for (const source of pool) {
    const items = Array.isArray(source.results) ? source.results : Array.isArray(source.data) ? source.data : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const url = readString(row.url || row.imageUrl);
      if (url && !urls.includes(url)) urls.push(url);
    }
    const single = readString(source.url || source.imageUrl);
    if (single && !urls.includes(single)) urls.push(single);
  }
  return urls;
}

function extractErrorMessage(payload: Record<string, unknown>) {
  const envelope = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload;
  return readString(envelope.error)
    || readString(envelope.reason)
    || readString(envelope.detail)
    || readString(envelope.description)
    || readString(envelope.failure_reason)
    || readString(envelope.message)
    || readString(payload.error)
    || readString(payload.reason)
    || readString(payload.detail)
    || readString(payload.description)
    || readString(payload.failure_reason)
    || readString(payload.message)
    || readString(payload.msg);
}

function resolveGrsaiSubmitPath(path: string | undefined, modelId: string) {
  const override = normalizeApiPath(path);
  if (override) return override;
  return /nano-banana/i.test(modelId) ? "/v1/draw/nano-banana" : "/v1/draw/completions";
}

function resolveGrsaiPollPath(path: string | undefined) {
  return normalizeApiPath(path) || "/v1/draw/result";
}

function normalizeApiPath(path: string | undefined) {
  const value = readString(path);
  if (!value) return "";
  return value.startsWith("/") ? value : `/${value}`;
}

function buildMissingImageResultError(payload: Record<string, unknown>, state: { taskId?: string; rawStatus?: string }) {
  const status = readString(state.rawStatus) || "success";
  const taskId = readString(state.taskId);
  const providerMessage = extractErrorMessage(payload);
  const detail = providerMessage && !["ok", "success", "succeeded", "completed", "done"].includes(providerMessage.toLowerCase())
    ? `: ${providerMessage}`
    : "";
  const taskSuffix = taskId ? ` (taskId=${taskId})` : "";
  return `GRSAI 任务状态 ${status} 但未返回图片${taskSuffix}${detail}`;
}

async function readJson(response: Response): Promise<{ payload: Record<string, unknown>; bodySnippet: string }> {
  const text = await response.text();
  if (!text) return { payload: {}, bodySnippet: "" };
  const normalized = text.startsWith("data: ") ? text.slice(6) : text;
  const bodySnippet = normalized.slice(0, 500);
  try {
    return { payload: JSON.parse(normalized) as Record<string, unknown>, bodySnippet };
  } catch {
    return { payload: { message: bodySnippet, rawBody: bodySnippet }, bodySnippet };
  }
}

function jsonHeaders(apiKey: string) {
  return {
    authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`,
    "content-type": "application/json",
    accept: "application/json"
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
