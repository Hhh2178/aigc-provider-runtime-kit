import { createOpenAICompatibleClient, OpenAICompatibleError } from "aigc-provider-runtime-kit/core";
import { createRunningHubClient, RunningHubError } from "aigc-provider-runtime-kit/runninghub";
import type { TaskRecord } from "../domain/task-machine.js";
import { parseAdvancedConfig } from "../domain/model-normalize.js";
import { openAiEndpoint } from "../domain/provider-test.js";
import { parseUpstreamJson, plainObject, safeText } from "../util.js";
import type { SecretCodec } from "../crypto.js";

export interface ProviderSecretView {
  id: string;
  protocol: string;
  baseUrl: string;
  apiKeyPlain: string;
  rhKeyPool: Array<{ id: string; apiKeyPlain: string; isDefault: boolean; enabled: boolean }>;
}

export interface TaskExecutionInput {
  task: TaskRecord;
  provider: ProviderSecretView;
  model: {
    id: string;
    modelId: string;
    capability: string;
    advancedConfig?: Record<string, unknown> | undefined;
  } | null;
  fetcher?: typeof fetch;
  /** Invoked on useful progress ticks (already persisted by the worker loop). */
  onHeartbeat?: (patch: Record<string, unknown>) => Promise<void>;
  signal?: AbortSignal;
}

export interface TaskExecutionOutcome {
  status: "succeeded" | "failed";
  result: Record<string, unknown>;
}

export class TaskAdapterNotPortedError extends Error {
  readonly protocol: string;

  constructor(protocol: string) {
    super(`协议适配器尚未移植: ${protocol}（阶段 2 将接入 apimart/aicopy/grsai/volcengine/gemini）`);
    this.name = "TaskAdapterNotPortedError";
    this.protocol = protocol;
  }
}

const OPENAI_FAMILY = new Set(["openai", "modelscope", "custom"]);

/**
 * Executes one claimed task by protocol. The contract mirrors the production
 * worker: submit, poll with heartbeats, and normalize outputs to
 * imageUrls/videoUrls/audioUrls/text regardless of upstream shape.
 */
export async function executeTask(input: TaskExecutionInput, codec: SecretCodec): Promise<TaskExecutionOutcome> {
  const { task, provider, model } = input;
  const protocol = String(task.result.protocol ?? task.payload.protocol ?? provider.protocol ?? "openai");
  try {
    if (protocol === "runninghub") {
      return await executeRunningHub(input, codec);
    }
    if (OPENAI_FAMILY.has(protocol)) {
      if (!model) throw new Error("缺少模型记录");
      if (model.capability === "chat") return await executeOpenAiChat(input);
      if (model.capability === "image") return await executeOpenAiImage(input);
      if (model.capability === "video") return await executeOpenAiVideo(input);
      if (model.capability === "audio") return await executeOpenAiAudio(input);
      throw new Error(`不支持的任务能力: ${model.capability}`);
    }
    throw new TaskAdapterNotPortedError(protocol);
  } catch (error) {
    return { status: "failed", result: failureResult(error, protocol, codec) };
  }
}

function failureResult(error: unknown, protocol: string, codec: SecretCodec) {
  const notPorted = error instanceof TaskAdapterNotPortedError;
  const upstream = error instanceof OpenAICompatibleError || error instanceof RunningHubError;
  return {
    error: plainMessage(error),
    failureCategory: notPorted ? "adapter_not_ported" : upstream ? "upstream_failed" : "execution_failed",
    providerState: "",
    runtimeStage: "failed",
    protocol,
    recoverable: upstream ? Boolean((error as { retryable?: boolean }).retryable) : false
  };
}

function plainMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 600);
  return String(error).slice(0, 600);
}

// -- openai family ----------------------------------------------------------

async function executeOpenAiChat(input: TaskExecutionInput): Promise<TaskExecutionOutcome> {
  const { task } = input;
  const params = plainObject(task.payload.input);
  const client = openAiClientFor(input);
  const response = await client.createChatCompletion({
    model: input.model?.modelId,
    messages: buildChatMessages(task.payload.prompt, params),
    stream: false,
    ...(Number.isFinite(Number(params.max_tokens)) ? { max_tokens: Number(params.max_tokens) } : {})
  });
  const raw = plainObject(response);
  const text = extractChatText(raw);
  if (!text.trim()) return { status: "failed", result: { error: "上游返回成功但没有文本内容", failureCategory: "empty_output", runtimeStage: "failed" } };
  return {
    status: "succeeded",
    result: { text, runtimeStage: "succeeded", providerState: "SUCCESS", upstreamTaskId: String(raw.id ?? ""), raw: compact(raw) }
  };
}

async function executeOpenAiImage(input: TaskExecutionInput): Promise<TaskExecutionOutcome> {
  const { task } = input;
  const params = plainObject(task.payload.input);
  const advanced = parseAdvancedConfig(input.model?.advancedConfig);
  const client = openAiClientFor(input);
  await input.onHeartbeat?.({ runtimeStage: "submitting", providerState: "SUBMITTING" });
  const response = await client.createImage({
    model: input.model?.modelId,
    prompt: String(task.payload.prompt ?? ""),
    ...(Number.isFinite(Number(params.n)) ? { n: Math.max(1, Math.min(4, Number(params.n))) } : {}),
    ...(safeText(params.size) ? { size: safeText(params.size) } : {}),
    ...(safeText(advanced.size) && !safeText(params.size) ? { size: safeText(advanced.size) } : {})

  });
  const raw = plainObject(response);
  const urls: string[] = [];
  const dataUrls: string[] = [];
  for (const item of Array.isArray(raw.data) ? raw.data : []) {
    const row = plainObject(item);
    if (safeText(row.url)) urls.push(safeText(row.url));
    else if (safeText(row.b64_json)) dataUrls.push(toDataUrl(safeText(row.b64_json)));
  }
  const imageUrls = [...urls, ...dataUrls];
  if (imageUrls.length === 0) {
    return { status: "failed", result: { error: "上游返回成功但没有图像内容", failureCategory: "empty_output", runtimeStage: "failed" } };
  }
  return {
    status: "succeeded",
    result: { imageUrls, runtimeStage: "succeeded", providerState: "SUCCESS", imageCount: imageUrls.length, raw: compact(raw) }
  };
}

async function executeOpenAiVideo(input: TaskExecutionInput): Promise<TaskExecutionOutcome> {
  const { task, provider } = input;
  const params = plainObject(task.payload.input);
  const advanced = parseAdvancedConfig(input.model?.advancedConfig);
  const submitPath = safeText(advanced.submitPath, "videos/generations");
  const submitUrl = openAiEndpoint(provider.baseUrl, submitPath);
  const response = await postJson(input.fetcher ?? fetch, submitUrl, provider.apiKeyPlain, {
    ...buildVideoBody(input.model?.modelId ?? "", task.payload.prompt ?? "", params, advanced),
    stream: false
  }, input.signal);
  const raw = plainObject(response.body);
  const upstreamTaskId = safeText(raw.id ?? plainObject(raw.data).id ?? raw.taskId ?? plainObject(raw.data).task_id);
  const direct = extractAvUrls(raw);
  if (direct.videoUrls.length > 0 && !upstreamTaskId) {
    return { status: "succeeded", result: { ...direct, runtimeStage: "succeeded", providerState: "SUCCESS", raw: compact(raw) } };
  }
  if (!upstreamTaskId) return { status: "failed", result: { error: "上游视频接口未返回任务ID或视频 URL", failureCategory: "invalid_provider_response", runtimeStage: "failed" } };
  await heartbeatPatch(input, { runtimeStage: "polling", providerState: "POLLING", upstreamTaskId });
  const pollTimeoutMs = Number(advanced.pollTimeoutMs) > 0 ? Number(advanced.pollTimeoutMs) : 15 * 60_000;
  const pollIntervalMs = Number(advanced.pollIntervalMs) > 0 ? Number(advanced.pollIntervalMs) : 2500;
  const statusPathRaw = safeText(advanced.taskStatusPath).replace(/%.*/, "");
  const statusUrl = safeText(statusPathRaw, `videos/${upstreamTaskId}`);
  const startedAt = Date.now();
  for (;;) {
    await delay(pollIntervalMs, input.signal);
    if (Date.now() - startedAt > pollTimeoutMs) {
      return { status: "failed", result: { error: "视频任务轮询超时", failureCategory: "upstream_poll_timeout", runtimeStage: "failed" } };
    }
    const poll = await fetchJson(input.fetcher ?? fetch, openAiEndpoint(provider.baseUrl, statusUrl), { method: "GET" }, provider.apiKeyPlain, input.signal);
    const pollRaw = plainObject(poll);
    const urls = extractAvUrls(pollRaw);
    const state = safeText(pollRaw.status ?? plainObject(pollRaw.data).status);
    await heartbeatPatch(input, { runtimeStage: "polling", providerState: state.toUpperCase(), upstreamTaskId, result: compact(pollRaw) });
    if (["failed", "FAILED", "error", "ERROR", "cancelled"].includes(state)) {
      return { status: "failed", result: { error: safeText(pollRaw.error, "上游视频任务失败"), failureCategory: "upstream_failed", runtimeStage: "failed" } };
    }
    if (urls.videoUrls.length > 0 || ["succeeded", "SUCCEEDED", "success", "SUCCESS", "completed", "COMPLETED", "done", "DONE"].includes(state)) {
      if (urls.imageUrls.length + urls.videoUrls.length === 0) {
        return { status: "failed", result: { error: "上游返回成功但没有视频内容", failureCategory: "empty_output", runtimeStage: "failed" } };
      }
      return { status: "succeeded", result: { ...urls, runtimeStage: "succeeded", providerState: "SUCCESS", upstreamTaskId, raw: compact(pollRaw) } };
    }
  }
}

async function executeOpenAiAudio(input: TaskExecutionInput): Promise<TaskExecutionOutcome> {
  const params = plainObject(input.task.payload.input);
  const advanced = parseAdvancedConfig(input.model?.advancedConfig);
  const audio: Record<string, unknown> = { format: safeText(advanced.audioFormat ?? params.audioFormat, "wav") };
  if (safeText(advanced.voice || params.voice)) audio.voice = safeText(advanced.voice || params.voice, "mimo_default");
  const sample = safeText(params.referenceAudio ?? advanced.referenceAudio);
  if (sample) audio.voice = sample;
  const client = openAiClientFor(input);
  const response = await client.createChatCompletion({
    model: input.model?.modelId,
    messages: [
      { role: "user", content: safeText(params.stylePrompt ?? input.task.payload.prompt ?? "") },
      { role: "assistant", content: safeText(input.task.payload.prompt ?? "") }
    ],
    audio
  });
  const raw = plainObject(response);
  const refs = collectAudioRefs(raw);
  if (refs.length === 0) {
    return { status: "failed", result: { error: "上游返回成功但没有音频内容", failureCategory: "empty_output", runtimeStage: "failed" } };
  }
  const audioUrls: string[] = [];
  for (const ref of refs) audioUrls.push(ref.startsWith("data:") ? ref : toDataUrl(ref));
  return {
    status: "succeeded",
    result: {
      text: extractChatText(raw),
      audioUrls,
      runtimeStage: "succeeded",
      providerState: "SUCCESS",
      audioCount: audioUrls.length,
      raw: compact(raw)
    }
  };
}

function openAiClientFor(input: TaskExecutionInput) {
  return createOpenAICompatibleClient({
    baseUrl: input.provider.baseUrl,
    apiKey: input.provider.apiKeyPlain,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    ...(input.signal ? {} : {})
  });
}

function buildChatMessages(prompt: unknown, params: Record<string, unknown>) {
  if (Array.isArray(params.messages) && params.messages.length > 0) return params.messages;
  return [{ role: "user", content: String(prompt ?? "") }];
}

function buildVideoBody(modelId: string, prompt: unknown, params: Record<string, unknown>, advanced: Record<string, unknown>) {
  return {
    model: modelId,
    prompt: String(prompt ?? ""),
    ...(Number.isFinite(Number(params.duration ?? advanced.duration)) ? { duration: Number(params.duration ?? advanced.duration) } : {}),
    ...(safeText(params.size || advanced.size) ? { size: safeText(params.size || advanced.size) } : {}),
    ...plainObject(advanced.fixedBody)
  };
}

// -- runninghub --------------------------------------------------------------

async function executeRunningHub(input: TaskExecutionInput, codecRef: SecretCodec): Promise<TaskExecutionOutcome> {
  const rh = plainObject(input.task.payload.runninghub);
  const catalogId = safeText(rh.catalogId);
  const runTargetId = safeText(rh.runTargetId);
  const kind = safeText(rh.kind) === "app" ? "app" : "workflow";
  if (!runTargetId) return { status: "failed", result: { error: "任务缺少 RunningHub 运行目标", failureCategory: "invalid_task_payload", runtimeStage: "failed" } };

  const poolKeys = input.provider.rhKeyPool.filter((item) => item.enabled && item.apiKeyPlain);
  const apiKey = poolKeys.find((item) => item.isDefault)?.apiKeyPlain || poolKeys[0]?.apiKeyPlain || input.provider.apiKeyPlain;
  if (!apiKey) return { status: "failed", result: { error: "Provider 未配置 RH API Key", failureCategory: "missing_credentials", runtimeStage: "failed" } };

  const client = createRunningHubClient({
    apiKey,
    baseUrl: input.provider.baseUrl,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),

  });
  try {
    const run = await client.runTask({
      targetType: kind,
      runTargetId,
      appId: kind === "app" ? runTargetId : "",
      workflowId: kind === "workflow" ? runTargetId : "",
      nodeInfoList: (Array.isArray(rh.nodeInfoList) ? rh.nodeInfoList : []).map((slot) => {
        const row = plainObject(slot);
        return { nodeId: String(row.nodeId ?? ""), fieldName: String(row.fieldName ?? ""), fieldValue: row.fieldValue };
      }),
      pollIntervalMs: Number(rh.pollIntervalMs) > 0 ? Number(rh.pollIntervalMs) : 5000,
      timeoutMs: Number(rh.timeoutMs) > 0 ? Number(rh.timeoutMs) : (Number(input.task.payload.timeoutMs) || 30 * 60_000),
      onHeartbeat: (patch) => {
        void input.onHeartbeat?.({
          runtimeStage: "polling",
          providerState: safeText(patch.upstreamStatus) || "POLLING",
          providerDiagnostic: safeText(patch.upstreamMessage),
          upstreamTaskId: safeText(patch.upstreamTaskId),
          progressPercent: parsePercent(patch.progress),
          catalogId
        });
      },
      ...(input.signal ? { signal: input.signal } : {})
    });
    return {
      status: "succeeded",
      result: {
        imageUrls: run.imageUrls,
        videoUrls: run.videoUrls,
        audioUrls: run.audioUrls,
        runtimeStage: "succeeded",
        providerState: "SUCCESS",
        upstreamTaskId: run.upstreamTaskId,
        catalogId,
        raw: compact(run.raw)
      }
    };
  } catch (error) {
    return { status: "failed", result: failureResult(error, "runninghub", codecRef) };
  }
}


// -- shared helpers ----------------------------------------------------------

async function heartbeatPatch(input: TaskExecutionInput, patch: Record<string, unknown>) {
  await input.onHeartbeat?.(patch);
}

function extractChatText(raw: Record<string, unknown>) {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const first = plainObject(choices[0]);
  const message = plainObject(first.message);
  const content = message.content ?? first.text ?? raw.output_text ?? raw.text ?? raw.content ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown> | string>)
      .map((item) => typeof item === "string" ? item : safeText(plainObject(item).text))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractAvUrls(raw: Record<string, unknown>) {
  const videoUrls: string[] = [];
  const imageUrls: string[] = [];
  collectMedia(raw, videoUrls, imageUrls);
  return { videoUrls: [...new Set(videoUrls)], imageUrls: [...new Set(imageUrls)], audioUrls: [] };
}

function collectMedia(value: unknown, videoUrls: string[], imageUrls: string[], seen = new Set<unknown>()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectMedia(item, videoUrls, imageUrls, seen);
    return;
  }
  const row = value as Record<string, unknown>;
  for (const [key, kind] of [["url", guessKind(String(row.url ?? ""))], ["videoUrl", "video"], ["video_url", "video"], ["imageUrl", "image"], ["image_url", "image"]] as const) {
    const text = safeText(row[key]);
    if (text && kind !== "" && kind !== undefined) {
      if (kind === "video") videoUrls.push(text);
      else imageUrls.push(text);
    }
  }
  for (const key of ["data", "videos", "video", "images", "image", "output", "outputs", "result", "results"]) {
    collectMedia(row[key], videoUrls, imageUrls, seen);
  }
}

function guessKind(url: string) {
  if (/\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(url)) return "video";
  if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)) return "image";
  return "";
}

function collectAudioRefs(raw: Record<string, unknown>): string[] {
  const candidates = [
    readStringAtPath(raw, "choices.0.message.audio.data"),
    readStringAtPath(raw, "choices.0.message.audio.url"),
    readStringAtPath(raw, "audio.data"),
    readStringAtPath(raw, "audio.url"),
    readStringAtPath(raw, "data.audio"),
    readStringAtPath(raw, "data.url")
  ].filter(Boolean);
  return [...new Set(candidates.filter((item) => /^data:|^https?:\/\//i.test(item)))];
}

function readStringAtPath(source: unknown, path: string): string {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) return "";
    if (/^\d+$/.test(part)) {
      if (!Array.isArray(current)) return "";
      current = current[Number(part)];
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else return "";
  }
  return typeof current === "string" ? current : "";
}

function toDataUrl(value: string) {
  if (/^data:/i.test(value)) return value;
  return `data:video/mp4;base64,${value.replace(/\s+/g, "")}`;
}

function parsePercent(value: unknown): number | undefined {
  const match = String(value ?? "").match(/(\d{1,3})\s*%/);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function compact(raw: Record<string, unknown>) {
  return raw;
}

async function postJson(fetcher: typeof fetch, url: string, apiKey: string, body: unknown, signal?: AbortSignal) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: apiKey.startsWith("Bearer") ? apiKey : `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    ...(signal ? { signal } : { signal: AbortSignal.timeout(120000) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`上游请求失败 ${response.status}: ${text.slice(0, 300)}`);
  return { status: response.status, body: text ? parseUpstreamJson(text, "视频生成接口") : {} };
}

async function fetchJson(fetcher: typeof fetch, url: string, init: { method: string }, apiKey: string, signal?: AbortSignal) {
  const response = await fetcher(url, {
    ...init,
    headers: { ...(apiKey ? { authorization: apiKey.startsWith("Bearer") ? apiKey : `Bearer ${apiKey}` } : {}) },
    ...(signal ? { signal } : { signal: AbortSignal.timeout(60000) })
  });
  const text = await response.text();
  return text ? parseUpstreamJson(text, "视频轮询接口") : {};
}

async function delay(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
  if (signal?.aborted) throw new Error("任务已取消");
}
