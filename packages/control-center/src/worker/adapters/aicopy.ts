/**
 * AICopy video adapter ported from the production module
 * (`xinghuan/packages/model-core/src/aicopy-video-adapter.ts`), including the
 * request-contract binding system, result/failure extraction, and the polling
 * loop with its completed-but-empty content fallback
 * (`xinghuan/apps/worker/src/worker-media-polling.ts`).
 */
import { openAiEndpoint } from "../../domain/provider-test.js";
import { parseUpstreamJson, safeText } from "../../util.js";

export interface AicopyRequestBinding {
  path: string;
  source?: "model" | "prompt" | "duration" | "ratio" | "resolution" | "modeType" | "referenceMode" | "images" | "videos" | "audios" | "media";
  value?: unknown;
  type?: "string" | "number" | "boolean" | "string[]" | "media[]";
  omitWhenEmpty?: boolean;
}

export interface AicopyRequestContract {
  bindings?: AicopyRequestBinding[];
  resultPaths?: string[];
}

export interface AicopyPayloadInput {
  modelId: string;
  prompt: string;
  ratio?: string;
  duration?: string | number;
  resolution?: string;
  modeType?: string;
  videoInputMode?: string;
  images?: string[];
  videos?: string[];
  audios?: string[];
  requestMapping?: Record<string, string>;
  requestValueTypes?: Record<string, string>;
  requestValueTemplates?: Record<string, string>;
  requestContractEnabled?: boolean;
  requestContract?: unknown;
  fixedBody?: Record<string, unknown>;
}

const AICOPY_SD_REQUEST_BINDINGS: AicopyRequestBinding[] = [
  { path: "duration", source: "duration", type: "number" },
  { path: "metadata.modeType", source: "modeType", type: "string" },
  { path: "metadata.ratio", source: "ratio", type: "string" },
  { path: "metadata.enableSound", value: "on", type: "string" },
  { path: "images", source: "images", type: "string[]", omitWhenEmpty: true },
  { path: "videos", source: "videos", type: "string[]", omitWhenEmpty: true },
  { path: "audios", source: "audios", type: "string[]", omitWhenEmpty: true }
];

const AICOPY_SD_RESULT_PATHS = ["result_url", "data.metadata.url", "data.output"];

export function mergeAicopySdRequestContractDefaults(value: unknown): Record<string, unknown> {
  const advancedConfig = plainObject(value);
  const currentContract = plainObject(advancedConfig.requestContract);
  const currentBindings = Array.isArray(currentContract.bindings)
    ? currentContract.bindings.filter((binding) => binding && typeof binding === "object" && !Array.isArray(binding)) as AicopyRequestBinding[]
    : [];
  const canonicalPaths = new Set(AICOPY_SD_REQUEST_BINDINGS.map((binding) => binding.path));
  const currentResultPaths = Array.isArray(currentContract.resultPaths)
    ? currentContract.resultPaths.map((path) => String(path || "").trim()).filter(Boolean)
    : [];
  const requestContractProfile = String(advancedConfig.requestContractProfile || "").trim()
    || (currentBindings.some((binding) => String(binding.path || "").trim() === "input.media") ? "sd2-per-request" : "");
  if (requestContractProfile && requestContractProfile !== "sd2-per-second") {
    return {
      ...advancedConfig,
      aicopyRequestContractEnabled: true,
      requestContract: {
        ...currentContract,
        bindings: currentBindings,
        resultPaths: [...new Set([...AICOPY_SD_RESULT_PATHS, ...currentResultPaths])]
      }
    };
  }
  return {
    ...advancedConfig,
    aicopyRequestContractEnabled: true,
    requestContract: {
      ...currentContract,
      bindings: [
        ...AICOPY_SD_REQUEST_BINDINGS.map((binding) => ({ ...binding })),
        ...currentBindings.filter((binding) => !canonicalPaths.has(String(binding.path || "").trim()))
      ],
      resultPaths: [...new Set([...AICOPY_SD_RESULT_PATHS, ...currentResultPaths])]
    }
  };
}

export function createAicopyVideoAdapterPayload(input: AicopyPayloadInput) {
  const payload: Record<string, unknown> = { model: input.modelId, prompt: input.prompt };
  const mapping = { ratio: "size", duration: "seconds", images: "images", ...plainObject(input.requestMapping) } as Record<string, string>;
  const valueTypes = plainObject(input.requestValueTypes) as Record<string, string>;
  const images = normalizePreviewImages(input.modelId, input.images);
  const videos = normalizePublicUrls(input.videos);
  const audios = normalizePublicUrls(input.audios);
  const media = createReferenceMedia(images, videos, audios);
  const size = previewVideoSizeFromRatio(input.ratio);
  const requestContract = input.requestContractEnabled
    ? normalizeRequestContract(input.requestContract)
    : { bindings: [], resultPaths: undefined };

  if (requestContract.bindings.length > 0) {
    applyRequestContract(payload, requestContract.bindings, {
      model: input.modelId,
      prompt: input.prompt,
      duration: input.duration,
      ratio: input.ratio,
      resolution: input.resolution,
      modeType: input.modeType,
      referenceMode: resolveReferenceMode(input.videoInputMode, images.length),
      images,
      videos,
      audios,
      media
    });
  } else {
    assignMapped(payload, mapping.ratio, size);
    assignMapped(payload, mapping.duration, castMappedValue(input.duration, valueTypes.duration));
    assignMapped(payload, mapping.resolution, castMappedValue(input.resolution, valueTypes.resolution));
    if (images.length > 0) assignMapped(payload, mapping.images, castMappedValue(images, valueTypes.images));
  }

  const mergedPayload = { ...payload, ...plainObject(input.fixedBody) };
  applyValueTemplates(mergedPayload, plainObject(input.requestValueTemplates), {
    model: input.modelId,
    prompt: input.prompt,
    ratio: String(input.ratio || ""),
    duration: String(input.duration || ""),
    resolution: String(input.resolution || ""),
    first_image: String(images[0] || ""),
    image_count: String(images.length),
    video_size: size,
    preview_video_size: size
  });
  return mergedPayload;
}

export function shouldUseAicopyVideoAdapter(input: { protocol?: string; advancedMode?: string; modelId?: string; providerBaseUrl?: string }) {
  return String(input.protocol || "").trim().toLowerCase() === "aicopy";
}

export function resolveAicopyRequestContractEnabled(config: unknown) {
  const advancedConfig = plainObject(config);
  return advancedConfig.requestContractEnabled === true || advancedConfig.aicopyRequestContractEnabled === true;
}

export function extractAicopyTask(raw: unknown, options: { taskIdPath?: string | undefined; statusPath?: string | undefined } = {}) {
  const data = firstDataNode(raw);
  return {
    taskId: readStringAtPath(raw, options.taskIdPath || "task_id")
      || readStringAtPath(raw, "data.task_id")
      || readStringAtPath(data, "task_id")
      || readStringAtPath(raw, "id")
      || readStringAtPath(raw, "request_id"),
    status: readStringAtPath(raw, options.statusPath || "status")
      || readStringAtPath(raw, "data.status")
      || readStringAtPath(data, "status")
      || readStringAtPath(raw, "request_status"),
    raw
  };
}

export function extractAicopyVideoResult(raw: unknown, options: { statusPath?: string | undefined; resultVideoPath?: string | undefined; resultPaths?: string[] | undefined } = {}) {
  const videoUrls = firstStringArrayAtPaths(raw, [
    ...normalizeResultPaths(options.resultPaths),
    "result_url",
    "content_url",
    "data.metadata.url",
    options.resultVideoPath || "data.output",
    "data.result.videos",
    "data.result.video_urls",
    "data.result.videoUrl",
    "data.video.url",
    "video.url",
    "output",
    "output.videos",
    "output.video_url"
  ]) || [];
  return {
    status: readStringAtPath(raw, options.statusPath || "status")
      || readStringAtPath(raw, "data.status")
      || readStringAtPath(raw, "data.0.status"),
    failureReason: extractAicopyFailureReason(raw),
    videoUrls,
    raw
  };
}

export function extractAicopyFailureReason(raw: unknown, depth = 0): string {
  if (depth > 5) return "";
  const directPaths = [
    "error.message", "error", "message", "msg", "failure_reason", "detail",
    "data.error.message", "data.error", "data.message", "data.msg"
  ];
  for (const path of directPaths) {
    const text = readReasonAtPath(raw, path);
    if (!text) continue;
    const nested = parseJsonObject(text);
    if (nested) {
      const nestedReason = extractAicopyFailureReason(nested, depth + 1);
      if (nestedReason) return nestedReason;
    }
    return text;
  }
  return "";
}

export function isAicopyCompletedStatus(status: string) {
  return ["completed", "succeeded", "success", "done", "succeed"].includes(status);
}

export function isAicopyFailedStatus(status: string) {
  return ["failed", "failure", "error", "cancelled", "canceled", "fail"].includes(status);
}

// -- polling ----------------------------------------------------------------

export async function pollAicopyVideoTask(options: {
  baseUrl: string;
  apiKey: string;
  taskId: string;
  statusPath?: string | undefined;
  resultVideoPath?: string | undefined;
  resultPaths?: string[] | undefined;
  pollPathTemplate?: string | undefined;
  contentPathTemplate?: string | undefined;
  pollIntervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  fetcher?: typeof fetch | undefined;
  onHeartbeat?: ((patch: Record<string, unknown>) => Promise<void> | void) | undefined;
}) {
  const fetcher = options.fetcher ?? fetch;
  const startedAt = Date.now();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : undefined;
  const pollIntervalMs = clampNumber(options.pollIntervalMs, 500, 10000, 2000);
  for (;;) {
    if (timeoutMs && Date.now() - startedAt > timeoutMs) throw new Error("视频生成轮询超时");
    if (pollIntervalMs > 0) await wait(pollIntervalMs);
    const pollPath = safeText(options.pollPathTemplate, "videos/{task_id}").replace("{task_id}", encodeURIComponent(options.taskId));
    const response = await fetcher(openAiEndpoint(options.baseUrl, pollPath), {
      method: "GET",
      headers: buildHeaders(options.apiKey),
      signal: AbortSignal.timeout(120000)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`视频任务轮询失败 ${response.status}: ${text.slice(0, 500)}`);
    const raw = text ? parseUpstreamJson(text, "AICopy 视频轮询") : {};
    const result = extractAicopyVideoResult(raw, {
      statusPath: options.statusPath,
      resultVideoPath: options.resultVideoPath,
      resultPaths: options.resultPaths
    });
    const status = safeText(result.status).toLowerCase();
    await options.onHeartbeat?.({
      upstreamTaskId: options.taskId,
      upstreamStatus: status || "pending",
      runtimeStage: "polling"
    });
    if (result.videoUrls.length > 0 && (!status || isAicopyCompletedStatus(status))) return result;
    if (isAicopyCompletedStatus(status)) {
      const contentPath = safeText(options.contentPathTemplate, "videos/{task_id}/content")
        .replace("{task_id}", encodeURIComponent(options.taskId));
      return { ...result, videoUrls: [openAiEndpoint(options.baseUrl, contentPath)], usedContentFallback: true };
    }
    if (isAicopyFailedStatus(status)) {
      throw new Error(`视频任务失败: ${safeText(result.failureReason, status || "unknown")}`);
    }
  }
}

// -- payload-contract helpers ------------------------------------------------

function applyRequestContract(
  target: Record<string, unknown>,
  bindings: AicopyRequestBinding[],
  values: Record<NonNullable<AicopyRequestBinding["source"]>, unknown>
) {
  for (const binding of bindings) {
    const sourceValue = binding.source ? values[binding.source] : binding.value;
    const value = castMappedValue(sourceValue, binding.type);
    if (isEmptyRequestValue(value)) continue;
    assignNestedValue(target, binding.path, value);
  }
}

function isEmptyRequestValue(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function assignNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = normalizeSafePath(path).split(".").filter(Boolean);
  if (parts.length === 0) return;
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const targetKey = parts[parts.length - 1] ?? "";
  if (!targetKey) return;
  current[targetKey] = value;
}

function normalizeRequestContract(value: unknown): { bindings: AicopyRequestBinding[]; resultPaths?: string[] } {
  const row = plainObject(value);
  const bindings = Array.isArray(row.bindings)
    ? row.bindings.map((item) => normalizeRequestBinding(item)).filter(Boolean) as AicopyRequestBinding[]
    : [];
  return { bindings, resultPaths: normalizeResultPaths(row.resultPaths) };
}

function normalizeRequestBinding(value: unknown): AicopyRequestBinding | null {
  const row = plainObject(value);
  const path = normalizeSafePath(row.path);
  const source = normalizeRequestSource(row.source);
  const hasValue = Object.prototype.hasOwnProperty.call(row, "value");
  if (!path || (!source && !hasValue)) return null;
  const type = normalizeRequestValueType(row.type);
  return {
    path,
    ...(source ? { source } : {}),
    ...(hasValue ? { value: row.value } : {}),
    ...(type ? { type } : {}),
    ...(row.omitWhenEmpty === true ? { omitWhenEmpty: true } : {})
  };
}

function normalizeRequestSource(value: unknown): AicopyRequestBinding["source"] | undefined {
  const source = String(value || "").trim();
  return ["model", "prompt", "duration", "ratio", "resolution", "modeType", "referenceMode", "images", "videos", "audios", "media"].includes(source)
    ? source as NonNullable<AicopyRequestBinding["source"]>
    : undefined;
}

function normalizeRequestValueType(value: unknown): AicopyRequestBinding["type"] | undefined {
  const type = String(value || "").trim();
  return ["string", "number", "boolean", "string[]", "media[]"].includes(type)
    ? type as NonNullable<AicopyRequestBinding["type"]>
    : undefined;
}

function normalizeSafePath(value: unknown) {
  const parts = String(value || "").trim().split(".").map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return "";
  return parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(part)) ? parts.join(".") : "";
}

function normalizePublicUrls(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function createReferenceMedia(images: string[], videos: string[], audios: string[]) {
  return [
    ...images.map((url) => ({ type: "reference_image", url })),
    ...videos.map((url) => ({ type: "reference_video", url })),
    ...audios.map((url) => ({ type: "reference_audio", url }))
  ];
}

function resolveReferenceMode(videoInputMode: unknown, imageCount: number) {
  const mode = String(videoInputMode || "").trim().toLowerCase();
  if (mode === "firstlast") return "start_end";
  if (mode === "first") return "start_frame";
  if (mode === "reference" && imageCount > 0) return "image_reference";
  return "";
}

function normalizeResultPaths(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter((item) => Boolean(normalizeSafePath(item))))]
    : [];
}

function applyValueTemplates(target: Record<string, unknown>, templates: Record<string, unknown>, context: Record<string, string>) {
  for (const [key, rawTemplate] of Object.entries(templates)) {
    const template = String(rawTemplate || "").trim();
    if (!key || !template) continue;
    const rendered = template.replace(/\{([a-z0-9_]+)\}/gi, (_, token) => context[String(token || "").toLowerCase()] || "");
    if (rendered.trim()) target[key] = rendered.trim();
  }
}

function previewVideoSizeFromRatio(ratioValue: unknown) {
  const ratio = String(ratioValue || "").trim();
  if (ratio === "16:9") return "1280x720";
  if (ratio === "9:16") return "720x1280";
  if (ratio === "1:1") return "1024x1024";
  if (ratio === "3:2") return "1792x1024";
  if (ratio === "2:3") return "1024x1792";
  return "";
}

function normalizePreviewImages(modelIdValue: unknown, images: string[] | undefined): string[] {
  const normalizedImages = Array.isArray(images) ? images.filter((item) => typeof item === "string" && item.trim()) : [];
  const modelId = String(modelIdValue || "").trim().toLowerCase();
  if (!modelId.includes("grok-imagine-video-1.5-preview")) return normalizedImages;
  if (modelId.includes("-official")) return normalizedImages;
  if (normalizedImages.length === 1) {
    const first = normalizedImages[0] ?? "";
    return [first, first];
  }
  return normalizedImages;
}

function assignMapped(target: Record<string, unknown>, key: string | undefined, value: unknown) {
  if (!key) return;
  if (typeof value === "string" && value.trim()) {
    target[key] = value.trim();
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
    return;
  }
  if (Array.isArray(value) && value.length > 0) target[key] = value;
}

function castMappedValue(value: unknown, typeHint: string | undefined) {
  const type = String(typeHint || "").trim().toLowerCase();
  if (!type || value === undefined || value === null) return value;
  if (type === "string") return Array.isArray(value) ? value.map((item) => String(item)) : String(value);
  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    return Boolean(value);
  }
  if (type === "string[]") {
    if (!Array.isArray(value)) return value === undefined || value === null ? [] : [String(value)];
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (type === "media[]") {
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  }
  return value;
}

function parseJsonObject(value: string) {
  const text = value.trim();
  if ((!text.startsWith("{") || !text.endsWith("}")) && (!text.startsWith("[") || !text.endsWith("]"))) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstDataNode(value: unknown) {
  const data = readPath(value, "data");
  if (Array.isArray(data)) return data[0];
  return data;
}

function readStringAtPath(value: unknown, path: string) {
  const result = readPath(value, path);
  return typeof result === "string" ? result.trim() : "";
}

function readReasonAtPath(value: unknown, path: string) {
  const result = readPath(value, path);
  return typeof result === "string" || typeof result === "number" ? String(result).trim() : "";
}

function firstStringArrayAtPaths(value: unknown, paths: string[]) {
  for (const path of paths) {
    const values = toStringArray(readPath(value, path));
    if (values && values.length > 0) return values;
  }
  return null;
}

function toStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const out = value.flatMap((item) => nestedStringValues(item)).filter(Boolean);
    return out.length > 0 ? out : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text ? [text] : null;
  }
  if (value && typeof value === "object") {
    const out = nestedStringValues(value).filter(Boolean);
    return out.length > 0 ? out : null;
  }
  return null;
}

function nestedStringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => nestedStringValues(item)).filter(Boolean);
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  for (const key of ["url", "video_url", "videoUrl", "src", "file_url"]) {
    const next = nestedStringValues(row[key]);
    if (next.length > 0) return next;
  }
  return [];
}

function readPath(value: unknown, path: string) {
  const parts = String(path || "").split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      current = Number.isFinite(index) ? current[index] : undefined;
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function buildHeaders(apiKey: string) {
  return {
    authorization: apiKey.startsWith("Bearer") ? apiKey : `Bearer ${apiKey}`,
    accept: "application/json",
    "content-type": "application/json"
  };
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
