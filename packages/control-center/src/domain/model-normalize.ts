import { parseInputCapabilities } from "aigc-provider-runtime-kit/core";
import type { ModelCapability, ModelCapabilityTag, ModelExecutionMode, ModelTestState } from "./types.js";
import { inferModelCapabilityTags, normalizeCapability, normalizeOptionalProtocol } from "./protocol-catalog.js";
import { plainObject, safeJsonText, safeText } from "../util.js";

const MODEL_CAPABILITY_TAGS = new Set<ModelCapabilityTag>([
  "text_chat",
  "image_understanding",
  "video_understanding",
  "audio_understanding",
  "reasoning",
  "long_context",
  "web_search",
  "image_generation",
  "image_edit",
  "video_generation",
  "tts",
  "voice_design",
  "voice_clone",
  "music_generation",
  "audio_cover",
  "audio_extend"
]);

export { parseInputCapabilities, normalizeCapability, inferModelCapabilityTags, normalizeOptionalProtocol };

export function normalizeModelCapabilityTags(value: unknown, capability: ModelCapability, modelId: unknown): ModelCapabilityTag[] {
  const source = Array.isArray(value) ? value : [];
  const tags = new Set<ModelCapabilityTag>();
  for (const item of source) {
    const tag = String(item || "").trim() as ModelCapabilityTag;
    if (MODEL_CAPABILITY_TAGS.has(tag)) tags.add(tag);
  }
  for (const tag of inferModelCapabilityTags(modelId, capability)) tags.add(tag);
  if (capability === "chat") tags.add("text_chat");
  if (capability === "image" && !tags.has("image_edit")) tags.add("image_generation");
  if (capability === "video") tags.add("video_generation");
  if (capability === "audio" && !tags.has("music_generation")) tags.add("tts");
  return [...tags];
}

export function normalizeModelTestState(value: unknown): ModelTestState {
  const source = plainObject(value);
  const out: ModelTestState = {};
  const keys = ["chat", "imageUnderstanding", "videoUnderstanding", "imageGeneration", "videoGeneration", "audioGeneration", "voiceClone"] as const;
  for (const key of keys) {
    const item = plainObject(source[key]);
    if (!Object.keys(item).length) continue;
    const latencyMs = Number(item.latencyMs);
    out[key] = {
      ok: Boolean(item.ok),
      status: Number.isFinite(Number(item.status)) ? Number(item.status) : 0,
      message: safeText(item.message),
      checkedAt: Number.isFinite(Number(item.checkedAt)) ? Number(item.checkedAt) : Date.now(),
      ...(Number.isFinite(latencyMs) ? { latencyMs: Math.max(0, Math.floor(latencyMs)) } : {}),
      inferredTags: normalizeModelCapabilityTags(item.inferredTags, "chat", "").filter((tag) => tag !== "text_chat"),
      sampleOutput: safeText(item.sampleOutput, "")
    };
  }
  return out;
}

export function normalizeModelInputProfile(
  value: unknown,
  inputCapabilities: ReturnType<typeof parseInputCapabilities>,
  capability: ModelCapability,
) {
  const requested = safeText(value);
  const parts = requested.split(",").map((item) => item.trim()).filter(Boolean);
  const out: string[] = [];
  const push = (token: string, enabled: boolean) => {
    if (enabled && !out.includes(token)) out.push(token);
  };
  push("prompt", inputCapabilities.prompt !== false || parts.length === 0);
  push("image_reference", inputCapabilities.imageReference || capability === "image" || capability === "video");
  push("video_reference", Boolean(inputCapabilities.videoReference));
  push("audio_reference", Boolean(inputCapabilities.audioReference) || capability === "audio");
  push("multi_image", Boolean(inputCapabilities.multiImage));
  push("first_frame", Boolean(inputCapabilities.firstFrame));
  push("last_frame", Boolean(inputCapabilities.lastFrame));
  for (const part of parts) if (!out.includes(part)) out.push(part);
  return out.join(",") || "prompt";
}

export function parseAdvancedConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const EXECUTION_MODES = new Set<string>(["sync_inline", "async_poll", "async_poll_then_final_lookup", "worker_queue"]);

export function normalizeExecutionMode(value: unknown, advancedConfig: Record<string, unknown>, capability: ModelCapability): ModelExecutionMode {
  const direct = typeof value === "string" ? value.trim() : "";
  if (EXECUTION_MODES.has(direct)) return direct as ModelExecutionMode;
  const bridged = typeof advancedConfig.executionMode === "string"
    ? advancedConfig.executionMode.trim()
    : typeof advancedConfig.mode === "string"
      ? advancedConfig.mode.trim()
      : "";
  if (EXECUTION_MODES.has(bridged)) return bridged as ModelExecutionMode;
  return capability === "chat" ? "sync_inline" : "worker_queue";
}

export function normalizeAdminModelRecord(model: import("./types.js").ModelRecord): import("./types.js").ModelRecord {
  const capability = normalizeCapability(model.capability);
  const inputCapabilities = parseInputCapabilities(model.inputCapabilities, capability);
  const inputProfile = normalizeModelInputProfile(model.inputProfile, inputCapabilities, capability);
  const capabilityTags = normalizeModelCapabilityTags(model.capabilityTags, capability, model.modelId);
  const advancedConfig = parseAdvancedConfig(model.advancedConfig);
  const executionMode = normalizeExecutionMode(model.executionMode, advancedConfig, capability);
  advancedConfig.executionMode = executionMode;
  return {
    ...model,
    sortOrder: normalizeCatalogSortOrder(model.sortOrder),
    capability,
    enabled: Boolean(model.enabled),
    executionMode,
    inputProfile,
    inputCapabilities: { ...inputCapabilities },
    capabilityTags,
    testState: normalizeModelTestState(model.testState),
    parameterSchema: safeJsonText(model.parameterSchema, "{}"),
    advancedConfig,
    protocolOverride: normalizeOptionalProtocol(model.protocolOverride)
  };
}

// ---------------------------------------------------------------------------
// display-order helpers (catalog sorting)
// ---------------------------------------------------------------------------

export interface DisplayOrderedRecord {
  id: string;
  sortOrder?: number | undefined;
  createdAt?: number | undefined;
}

export function normalizeCatalogSortOrder(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : Math.trunc(fallback);
}

export function sortByCatalogDisplayOrder<T extends DisplayOrderedRecord>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const orderDelta = normalizeCatalogSortOrder(left.sortOrder) - normalizeCatalogSortOrder(right.sortOrder);
    if (orderDelta !== 0) return orderDelta;
    const createdDelta = normalizeCatalogSortOrder(right.createdAt) - normalizeCatalogSortOrder(left.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return String(left.id).localeCompare(String(right.id));
  });
}

export function applyCatalogDisplayOrder<T extends DisplayOrderedRecord>(items: T[], orderedIds: unknown): T[] {
  const ids = Array.isArray(orderedIds) ? orderedIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  const currentIds = items.map((item) => item.id);
  if (ids.length !== currentIds.length || new Set(ids).size !== ids.length) {
    throw new Error("CATALOG_DISPLAY_ORDER_SCOPE_MISMATCH");
  }
  const currentIdSet = new Set(currentIds);
  if (ids.some((id) => !currentIdSet.has(id))) {
    throw new Error("CATALOG_DISPLAY_ORDER_SCOPE_MISMATCH");
  }
  const orderById = new Map(ids.map((id, index) => [id, index * 10]));
  return items.map((item) => ({ ...item, sortOrder: orderById.get(item.id) ?? 0 }));
}
