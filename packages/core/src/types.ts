export type ModelCapability = "chat" | "image" | "video" | "audio";

export type ProviderProtocol =
  | "openai"
  | "gemini"
  | "runninghub"
  | "volcengine"
  | "apimart"
  | "modelscope"
  | "custom";

export type ModelCapabilityTag =
  | "text_chat"
  | "image_understanding"
  | "video_understanding"
  | "audio_understanding"
  | "reasoning"
  | "long_context"
  | "web_search"
  | "image_generation"
  | "image_edit"
  | "video_generation"
  | "tts"
  | "voice_design"
  | "voice_clone"
  | "music_generation";

export interface ModelInputCapabilities {
  prompt?: boolean;
  imageReference?: boolean;
  multiImage?: boolean;
  firstFrame?: boolean;
  lastFrame?: boolean;
  mask?: boolean;
  audioReference?: boolean;
  videoReference?: boolean;
}

export interface ModelDurationRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ModelParameterSchema {
  prompt?: { type?: string; required?: boolean };
  aspectRatio?: { type?: string; options?: string[]; default?: string };
  size?: { type?: string; options?: string[]; default?: string };
  referenceImages?: { type?: string; max?: number };
  referenceAudio?: { type?: string; max?: number; formats?: string[] };
  duration?: {
    type?: string;
    options?: Array<string | number>;
    default?: string | number;
    mode?: "tiers" | "range" | string;
    min?: number;
    max?: number;
    step?: number;
  };
  resolution?: { type?: string; options?: string[]; default?: string };
  audioFormat?: { type?: string; options?: string[]; default?: string };
  voice?: { type?: string; options?: string[]; default?: string };
  [key: string]: unknown;
}

export interface ModelUiMetadata {
  aspectRatios: string[];
  defaultAspectRatio: string;
  sizes: string[];
  defaultSize: string;
  supportsReference: boolean;
  maxReferenceImages: number;
  durationOptions: Array<string | number>;
  defaultDuration: string | number;
  durationMode?: "tiers" | "range";
  durationRange?: ModelDurationRange;
  resolutionOptions: string[];
  defaultResolution: string;
  inputCapabilities: Required<Pick<ModelInputCapabilities, "prompt" | "imageReference" | "videoReference" | "audioReference" | "multiImage" | "firstFrame" | "lastFrame">>;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  note?: string;
}

export interface ProviderModelDefinition {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  capability: ModelCapability;
  enabled: boolean;
  inputCapabilities?: ModelInputCapabilities;
  capabilityTags?: ModelCapabilityTag[];
  parameterSchema?: ModelParameterSchema;
  advancedConfig?: Record<string, unknown>;
  protocolOverride?: ProviderProtocol;
}
