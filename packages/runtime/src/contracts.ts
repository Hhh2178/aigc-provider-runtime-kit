import type { ModelCapability, ProviderDefinition, ProviderModelDefinition } from "../../core/src/index.js";

export type ProviderOutputType = "text" | "image" | "video" | "audio" | "json";

export interface ProviderExecutionOutput {
  type: ProviderOutputType;
  url?: string;
  text?: string;
  mimeType?: string;
  data?: unknown;
}

export interface ProviderExecutionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  [key: string]: number | undefined;
}

export interface ProviderExecutionInput {
  providerId: string;
  modelId: string;
  input: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderExecutionResult {
  status: "completed";
  providerId: string;
  modelId: string;
  capability: ModelCapability;
  taskId?: string;
  outputs: ProviderExecutionOutput[];
  usage?: ProviderExecutionUsage;
  raw?: unknown;
}

export interface ProviderAdapterContext {
  provider: ProviderDefinition;
  model: ProviderModelDefinition;
  input: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  emitProgress: (progress: ProviderProgress) => Promise<void>;
}

export interface ProviderProgress {
  status?: string;
  percent?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface ProviderAdapter {
  id: string;
  supports(provider: ProviderDefinition, model: ProviderModelDefinition): boolean;
  execute(context: ProviderAdapterContext): Promise<ProviderExecutionResult>;
}

export type ProviderRuntimeEvent =
  | { type: "execution.started"; executionId: string; request: ProviderExecutionInput }
  | { type: "execution.validated"; executionId: string; provider: ProviderDefinition; model: ProviderModelDefinition }
  | { type: "adapter.selected"; executionId: string; adapterId: string }
  | { type: "execution.progress"; executionId: string; progress: ProviderProgress }
  | { type: "execution.succeeded"; executionId: string; result: ProviderExecutionResult; durationMs: number }
  | { type: "execution.failed"; executionId: string; error: unknown; durationMs: number };

export interface ProviderRuntimeHooks {
  onEvent?: (event: ProviderRuntimeEvent) => void | Promise<void>;
}
