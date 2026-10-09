import type { ModelCapability, ModelDurationRange, ModelInputCapabilities, ModelParameterSchema, ModelUiMetadata, ProviderProtocol } from "./types.js";

const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const OPENAI_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"];
const VIDEO_RATIOS = ["16:9", "9:16", "1:1"];
const VIDEO_DURATIONS = [4, 6, 8, 10, 15];
const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
const AUDIO_FORMATS = ["wav", "mp3", "pcm16"];

export function parseModelParameterSchema(value: unknown): ModelParameterSchema {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as ModelParameterSchema;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ModelParameterSchema : {};
  } catch {
    return {};
  }
}

export function defaultParameterSchemaForModel(capability: ModelCapability, modelId: string, protocol: ProviderProtocol = "openai"): ModelParameterSchema {
  if (capability === "image") {
    const lower = modelId.toLowerCase();
    const sizes = protocol === "openai" || lower.includes("gpt-image") ? OPENAI_IMAGE_SIZES : ["1K", "2K", "4K"];
    return {
      prompt: { type: "string", required: true },
      aspectRatio: { type: "select", options: IMAGE_RATIOS, default: "1:1" },
      size: { type: "select", options: sizes, default: sizes[0] || "" },
      referenceImages: { type: "image[]", max: lower.includes("gpt-image") ? 9 : 4 }
    };
  }
  if (capability === "video") {
    return {
      prompt: { type: "string", required: true },
      aspectRatio: { type: "select", options: VIDEO_RATIOS, default: "16:9" },
      duration: { type: "select", options: VIDEO_DURATIONS, default: 6 },
      resolution: { type: "select", options: VIDEO_RESOLUTIONS, default: "720p" },
      referenceImages: { type: "image[]", max: 1 }
    };
  }
  if (capability === "audio") {
    return {
      prompt: { type: "string", required: true },
      audioFormat: { type: "select", options: AUDIO_FORMATS, default: "wav" },
      referenceAudio: { type: "audio[]", max: 1, formats: ["mp3", "wav"] }
    };
  }
  return { prompt: { type: "string", required: true } };
}

export function mergeModelParameterSchema(capability: ModelCapability, modelId: string, protocol: ProviderProtocol, value: unknown): ModelParameterSchema {
  return {
    ...defaultParameterSchemaForModel(capability, modelId, protocol),
    ...parseModelParameterSchema(value)
  };
}

export function parseInputCapabilities(value: unknown, capability: ModelCapability): ModelInputCapabilities {
  const source = plainObject(value);
  const schema = parseModelParameterSchema(source.parameterSchema);
  const maxRef = Number(schema.referenceImages?.max);
  return {
    prompt: source.prompt !== false,
    imageReference: source.imageReference === undefined ? Boolean(schema.referenceImages) : Boolean(source.imageReference),
    multiImage: source.multiImage === undefined ? Number.isFinite(maxRef) && maxRef > 1 : Boolean(source.multiImage),
    firstFrame: Boolean(source.firstFrame),
    lastFrame: Boolean(source.lastFrame),
    mask: Boolean(source.mask),
    audioReference: source.audioReference === undefined ? capability === "audio" && Boolean(schema.referenceAudio) : Boolean(source.audioReference),
    videoReference: Boolean(source.videoReference)
  };
}

export function uiMetadataFromSchema(schemaValue: unknown, capability: ModelCapability, inputCapabilitiesValue?: unknown): ModelUiMetadata {
  const schema = parseModelParameterSchema(schemaValue);
  const aspectRatios = compactStrings(schema.aspectRatio?.options, capability === "video" ? VIDEO_RATIOS : IMAGE_RATIOS);
  const sizes = compactStrings(schema.size?.options, capability === "image" ? OPENAI_IMAGE_SIZES : []);
  const durationSchema = plainObject(schema.duration);
  const durationMode = capability === "video" ? resolveDurationMode(durationSchema) : undefined;
  const durationRange = capability === "video" ? resolveDurationRange(durationSchema) : undefined;
  const durationOptions = capability === "video"
    ? durationMode === "range"
      ? durationOptionsFromRange(durationRange)
      : compactValues(schema.duration?.options, VIDEO_DURATIONS)
    : compactValues(schema.duration?.options, []);
  const resolutionOptions = compactStrings(schema.resolution?.options, capability === "video" ? VIDEO_RESOLUTIONS : []);
  const inputCapabilities = parseInputCapabilities({ ...plainObject(inputCapabilitiesValue), parameterSchema: schema }, capability);
  return {
    aspectRatios,
    defaultAspectRatio: stringInList(schema.aspectRatio?.default, aspectRatios, aspectRatios[0] || "1:1"),
    sizes,
    defaultSize: stringInList(schema.size?.default, sizes, sizes[0] || ""),
    supportsReference: Boolean(schema.referenceImages),
    maxReferenceImages: clampInteger(Number(schema.referenceImages?.max), 0, 16, 0),
    durationOptions,
    defaultDuration: durationMode === "range"
      ? durationRange?.default ?? valueInList(schema.duration?.default, durationOptions, durationOptions[0] || 0)
      : valueInList(schema.duration?.default, durationOptions, durationOptions[0] || ""),
    ...(durationMode ? { durationMode } : {}),
    ...(durationRange ? { durationRange } : {}),
    resolutionOptions,
    defaultResolution: stringInList(schema.resolution?.default, resolutionOptions, resolutionOptions[0] || ""),
    inputCapabilities: {
      prompt: inputCapabilities.prompt !== false,
      imageReference: Boolean(inputCapabilities.imageReference),
      videoReference: Boolean(inputCapabilities.videoReference),
      audioReference: Boolean(inputCapabilities.audioReference),
      multiImage: Boolean(inputCapabilities.multiImage),
      firstFrame: Boolean(inputCapabilities.firstFrame),
      lastFrame: Boolean(inputCapabilities.lastFrame)
    }
  };
}

export function durationOptionsFromRange(range?: ModelDurationRange): number[] {
  if (!range) return [];
  const out: number[] = [];
  for (let value = range.min; value <= range.max; value += range.step) {
    out.push(value);
    if (out.length > 128) break;
  }
  if (!out.includes(range.default)) out.push(range.default);
  return out.sort((a, b) => a - b);
}

function resolveDurationMode(value: Record<string, unknown>): "tiers" | "range" | undefined {
  const mode = String(value.mode || value.type || "").toLowerCase();
  if (mode === "range") return "range";
  if (mode === "tiers" || mode === "select" || mode === "enum") return "tiers";
  if (Number.isFinite(Number(value.min)) && Number.isFinite(Number(value.max))) return "range";
  if (Array.isArray(value.options)) return "tiers";
  return undefined;
}

function resolveDurationRange(value: Record<string, unknown>): ModelDurationRange | undefined {
  const min = Math.max(1, Math.round(Number(value.min)));
  const max = Math.max(min, Math.round(Number(value.max)));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  const step = Math.max(1, Math.round(Number(value.step) || 1));
  return { min, max, step, default: clampInteger(Number(value.default), min, max, min) };
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactStrings(values: unknown, fallback: string[]): string[] {
  return compactValues(values, fallback).map(String);
}

function compactValues(values: unknown, fallback: Array<string | number>): Array<string | number> {
  const source = Array.isArray(values) ? values : fallback;
  const out: Array<string | number> = [];
  for (const value of source) {
    if ((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value))) {
      if (!out.includes(value)) out.push(value);
    }
  }
  return out;
}

function stringInList(value: unknown, list: string[], fallback: string) {
  const text = String(value || "");
  return list.includes(text) ? text : fallback;
}

function valueInList(value: unknown, list: Array<string | number>, fallback: string | number) {
  return list.includes(value as string | number) ? value as string | number : fallback;
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}
