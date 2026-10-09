import type { ModelCapabilityTag, ModelRecord, ProviderModelImportResult } from "./types.js";
import { inferModelCapabilityTags, normalizeCapability, normalizeOptionalProtocol } from "./protocol-catalog.js";
import { normalizeModelCapabilityTags, normalizeModelTestState, normalizeAdminModelRecord, parseAdvancedConfig } from "./model-normalize.js";
import { safeSlug, safeText } from "../util.js";

export interface ProviderModelImportInput {
  modelId?: string;
  capability?: string;
  displayName?: string;
  protocolOverride?: string;
  capabilityTags?: unknown;
}

export interface ImportModelDependencies {
  normalizeCapability: typeof normalizeCapability;
  normalizeModelCapabilityTags: typeof normalizeModelCapabilityTags;
  inferModelCapabilityTags: typeof inferModelCapabilityTags;
  normalizeOptionalProtocol: typeof normalizeOptionalProtocol;
  normalizeAdminModelRecord: typeof normalizeAdminModelRecord;
  normalizeModelTestState: typeof normalizeModelTestState;
  plainObject: typeof parseAdvancedConfig;
  safeSlug: typeof safeSlug;
  safeText: typeof safeText;
}

export function importProviderModels(input: {
  providerId: string;
  now: number;
  existing: ModelRecord[];
  incoming: ProviderModelImportInput[];
  deps: ImportModelDependencies;
}): ProviderModelImportResult {
  const { deps } = input;
  const models = [...input.existing];
  const touched: ModelRecord[] = [];
  let imported = 0;
  for (const item of input.incoming) {
    const modelId = deps.safeText(item.modelId);
    if (!modelId) continue;
    const capability = deps.normalizeCapability(item.capability);
    const capabilityTags = deps.normalizeModelCapabilityTags(
      item.capabilityTags === undefined ? deps.inferModelCapabilityTags(modelId, capability) : item.capabilityTags,
      capability,
      modelId
    );
    const id = deps.safeSlug(`${input.providerId}-${capability}-${modelId}`, `model-${input.now}-${imported}`);
    const existingIndex = models.findIndex((model) => model.providerId === input.providerId && model.modelId === modelId);
    const existing = existingIndex >= 0 ? models[existingIndex] : undefined;
    const model: ModelRecord = {
      id: existing?.id || id,
      providerId: input.providerId,
      modelId,
      displayName: deps.safeText(item.displayName, modelId),
      capability,
      enabled: true,
      inputProfile: existing?.inputProfile || (capability === "audio" ? "prompt,audio_reference" : capability === "image" || capability === "video" ? "prompt,image_reference" : "prompt"),
      inputCapabilities: existing
        ? deps.plainObject(existing.inputCapabilities)
        : capability === "audio"
          ? { prompt: true, audioReference: capabilityTags.includes("voice_clone") }
          : capability === "video" || capability === "image"
            ? { prompt: true, imageReference: true, multiImage: false, firstFrame: false, lastFrame: false }
            : {
                prompt: true,
                imageReference: capabilityTags.includes("image_understanding"),
                videoReference: capabilityTags.includes("video_understanding"),
                audioReference: capabilityTags.includes("audio_understanding"),
                multiImage: false,
                firstFrame: false,
                lastFrame: false
              },
      capabilityTags: existing
        ? deps.normalizeModelCapabilityTags(existing.capabilityTags, capability, modelId)
        : capabilityTags,
      testState: existing ? deps.normalizeModelTestState(existing.testState) : {},
      parameterSchema: existing?.parameterSchema || "{}",
      advancedConfig: existing ? deps.plainObject(existing.advancedConfig) : {},
      protocolOverride: deps.normalizeOptionalProtocol(item.protocolOverride),
      createdAt: existing?.createdAt || input.now,
      updatedAt: input.now
    };
    const normalized = deps.normalizeAdminModelRecord(existing ? { ...existing, ...model } : model);
    if (existingIndex >= 0) models[existingIndex] = normalized;
    else models.unshift(normalized);
    touched.push(normalized);
    imported += 1;
  }
  return { imported, nextModels: models, touchedModels: touched };
}

export { normalizeModelCapabilityTags, type ModelCapabilityTag, parseAdvancedConfig };
