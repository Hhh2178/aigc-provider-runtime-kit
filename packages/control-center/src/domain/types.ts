import type {
  ModelCapability,
  ModelCapabilityTag,
  ModelInputCapabilities,
  ModelParameterSchema,
  ProviderProtocol
} from "aigc-provider-runtime-kit/core";
import type { RhCatalogEntry, RhCatalogGroup } from "./runninghub/catalog.js";

export type {
  ModelCapability,
  ModelCapabilityTag,
  ModelInputCapabilities,
  ModelParameterSchema,
  ProviderProtocol
};

export type { RhCatalogEntry, RhCatalogGroup };

export type ModelExecutionMode = "sync_inline" | "async_poll" | "async_poll_then_final_lookup" | "worker_queue";

export interface ModelTestResult {
  ok: boolean;
  status: number;
  message: string;
  checkedAt: number;
  latencyMs?: number | undefined;
  inferredTags?: ModelCapabilityTag[];
  sampleOutput?: string;
}

export interface ModelTestState {
  chat?: ModelTestResult;
  imageUnderstanding?: ModelTestResult;
  videoUnderstanding?: ModelTestResult;
  imageGeneration?: ModelTestResult;
  videoGeneration?: ModelTestResult;
  audioGeneration?: ModelTestResult;
  voiceClone?: ModelTestResult;
}

export interface ModelAdvancedConfig {
  mode?: string;
  submitPath?: string;
  requestMapping?: Record<string, string>;
  referenceImageTransport?: "url" | "data_url";
  fixedBody?: Record<string, unknown>;
  taskStatusPath?: string;
  taskIdPath?: string;
  resultVideoPath?: string;
  pollPathTemplate?: string;
  finalResultTaskIdPath?: string;
  finalResultPathTemplate?: string;
  finalResultVideoPath?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  voice?: string;
  audioFormat?: string;
  executionMode?: string;
  [key: string]: unknown;
}

export interface ModelScopeLora {
  id: string;
  name?: string;
  targetModel: string;
  strength: number;
  enabled: boolean;
  note?: string;
}

export interface RhKeyPoolItemRecord {
  id: string;
  note: string;
  apiKey?: string | undefined;
  apiKeyPreview?: string | undefined;
  maxConcurrency: number;
  enabled: boolean;
  isDefault: boolean;
  standardModelApi: boolean;
  currentInFlight?: number | undefined;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderRecord {
  id: string;
  sortOrder?: number | undefined;
  name: string;
  baseUrl: string;
  protocol?: ProviderProtocol | undefined;
  enabled: boolean;
  apiKey?: string | undefined;
  apiKeyPreview?: string | undefined;
  lastProbeStatus?: string | undefined;
  lastProbeMessage?: string | undefined;
  lastFetchedAt?: number | undefined;
  rhApps?: RhCatalogEntry[] | undefined;
  rhWorkflows?: RhCatalogEntry[] | undefined;
  rhGroups?: RhCatalogGroup[] | undefined;
  rhKeyPool?: RhKeyPoolItemRecord[] | undefined;
  msLoras?: ModelScopeLora[] | undefined;
  note?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

export type PublicProviderRecord = Omit<ProviderRecord, "apiKey" | "apiKeyPreview"> & {
  hasApiKey: boolean;
  apiKeyPreview?: string;
  rhKeyPoolSummary: RhKeyPoolSummary;
};

export interface RhKeyPoolSummary {
  totalKeyCount: number;
  enabledKeyCount: number;
  totalConcurrency: number;
  activeInFlight: number;
}

export interface ModelRecord {
  id: string;
  sortOrder?: number | undefined;
  providerId: string;
  modelId: string;
  displayName: string;
  capability: ModelCapability;
  enabled: boolean;
  executionMode?: ModelExecutionMode | undefined;
  inputProfile: string;
  inputCapabilities?: ModelInputCapabilities | Record<string, unknown>;
  capabilityTags?: ModelCapabilityTag[] | undefined;
  testState?: ModelTestState | undefined;
  parameterSchema: string;
  advancedConfig?: ModelAdvancedConfig | Record<string, unknown>;
  protocolOverride?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderModelImportResult {
  imported: number;
  nextModels: ModelRecord[];
  touchedModels: ModelRecord[];
}
