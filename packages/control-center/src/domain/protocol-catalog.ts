import type { ModelCapability, ModelCapabilityTag, ProviderProtocol } from "./types.js";

export interface ParsedUpstreamModels {
  total: number;
  all: string[];
  chatModels: string[];
  imageModels: string[];
  videoModels: string[];
  audioModels: string[];
  modelTags: Record<string, ModelCapabilityTag[]>;
}

const PROVIDER_PROTOCOLS = ["openai", "gemini", "runninghub", "volcengine", "apimart", "aicopy", "modelscope", "custom", "grsai_draw"] as const;

export function normalizeCapability(value: unknown): ModelCapability {
  const capability = String(value || "").toLowerCase();
  if (capability === "text" || capability === "llm") return "chat";
  if (["tts", "speech", "voice", "music"].includes(capability)) return "audio";
  return ["chat", "image", "video", "audio"].includes(capability) ? (capability as ModelCapability) : "image";
}

export function normalizeProviderProtocol(value: unknown): ProviderProtocol {
  const protocol = String(value || "").toLowerCase();
  return (PROVIDER_PROTOCOLS as readonly string[]).includes(protocol) ? (protocol as ProviderProtocol) : "openai";
}

export function normalizeOptionalProtocol(value: unknown) {
  const protocol = String(value || "").toLowerCase();
  return (PROVIDER_PROTOCOLS as readonly string[]).includes(protocol) ? protocol : "";
}

export function providerModelsUrl(baseUrlValue: unknown, protocolValue: unknown) {
  const baseUrl = String(baseUrlValue ?? "").trim().replace(/\/+$/, "");
  const protocol = normalizeProviderProtocol(protocolValue);
  if (!baseUrl) return "";
  if (protocol === "grsai_draw") return "";
  if (protocol === "gemini") return baseUrl.endsWith("/v1beta") ? `${baseUrl}/models` : `${baseUrl}/v1beta/models`;
  if (protocol === "volcengine") return baseUrl.endsWith("/api/v3") ? `${baseUrl}/models` : `${baseUrl}/api/v3/models`;
  if (protocol === "runninghub") return `${baseUrl}/openapi/v2/models`;
  return baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

export function providerModelHeaders(apiKey: string, protocolValue: unknown): Record<string, string> {
  const protocol = normalizeProviderProtocol(protocolValue);
  if (protocol === "gemini") return { "x-goog-api-key": apiKey, accept: "application/json" };
  if (protocol === "runninghub") return { authorization: apiKey.replace(/^Bearer\s+/i, ""), accept: "application/json" };
  return { authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`, accept: "application/json" };
}

export function classifyUpstreamModel(modelId: unknown): ModelCapability {
  const value = String(modelId || "").toLowerCase();
  const audioKeys = ["mimo-v2.5-tts", "tts", "text-to-speech", "speech", "voiceclone", "voice_clone", "voice-clone", "suno", "music"];
  if (audioKeys.some((key) => value.includes(key))) return "audio";
  const videoKeys = ["veo", "sora", "wan2", "wanx", "seedance", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"];
  if (videoKeys.some((key) => value.includes(key))) return "video";
  const imageKeys = [
    "banana", "image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney",
    "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein", "seedream",
    "text-to-image", "image-to-image"
  ];
  if (imageKeys.some((key) => value.includes(key))) return "image";
  return "chat";
}

export function inferModelCapabilityTags(modelId: unknown, capabilityValue?: unknown): ModelCapabilityTag[] {
  const value = String(modelId || "").toLowerCase();
  const capability = normalizeCapability(capabilityValue || classifyUpstreamModel(modelId));
  const tags = new Set<ModelCapabilityTag>();
  if (capability === "chat") tags.add("text_chat");
  if (capability === "image") tags.add(value.includes("edit") || value.includes("image-to-image") ? "image_edit" : "image_generation");
  if (capability === "video") tags.add("video_generation");
  if (capability === "audio") tags.add("tts");
  if (/\bvl\b|qwen\d*(?:\.?\d*)?-vl|vision|visual|omni|multimodal|multi-modal/.test(value)) tags.add("image_understanding");
  if (/video[_-]?understanding|video[_-]?chat|video[_-]?vl|qwen.*vl|omni/.test(value)) tags.add("video_understanding");
  if (/audio[_-]?understanding|audio[_-]?chat|asr|speech[_-]?recognition|omni/.test(value)) tags.add("audio_understanding");
  if (/thinking|reason|reasoning|qwq|r1|deepseek-v4|glm-5\.1/.test(value)) tags.add("reasoning");
  if (/long|128k|200k|1m|million|context/.test(value)) tags.add("long_context");
  if (/web[_-]?search|search/.test(value)) tags.add("web_search");
  if (/voice[_-]?design|voicedesign/.test(value)) tags.add("voice_design");
  if (/voice[_-]?clone|voiceclone/.test(value)) tags.add("voice_clone");
  if (/suno|music|song/.test(value)) tags.add("music_generation");
  if (/cover/.test(value)) tags.add("audio_cover");
  if (/extend/.test(value)) tags.add("audio_extend");
  return [...tags];
}

export function parseUpstreamModels(raw: unknown, protocolValue: unknown): ParsedUpstreamModels {
  const protocol = normalizeProviderProtocol(protocolValue);
  const object = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawItems = Array.isArray(object.data)
    ? object.data
    : Array.isArray(object.models)
      ? object.models
      : Array.isArray(object.list)
        ? object.list
        : [];
  const ids = new Set<string>();
  for (const item of rawItems) {
    let modelId = "";
    if (typeof item === "string") modelId = item;
    else if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      modelId = safeText(row.id || row.name || row.model);
    }
    if (protocol === "gemini" && modelId.startsWith("models/")) modelId = modelId.slice("models/".length);
    if (modelId) ids.add(modelId);
  }
  const all = [...ids].sort();
  const grouped: Record<ModelCapability, string[]> = { chat: [], image: [], video: [], audio: [] };
  const modelTags: Record<string, ModelCapabilityTag[]> = {};
  for (const modelId of all) {
    const capability = classifyUpstreamModel(modelId);
    grouped[capability].push(modelId);
    modelTags[modelId] = inferModelCapabilityTags(modelId, capability);
  }
  return { total: all.length, all, chatModels: grouped.chat, imageModels: grouped.image, videoModels: grouped.video, audioModels: grouped.audio, modelTags };
}

function safeText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 240);
}
