import type { ProviderDefinition, ProviderModelDefinition } from "../../core/src/index.js";
import type { RunningHubNodeInfoItem, RunningHubRunInput, RunningHubRunResult } from "../../runninghub/src/index.js";
import type { ProviderAdapter, ProviderAdapterContext, ProviderExecutionOutput, ProviderExecutionResult, ProviderExecutionUsage } from "./contracts.js";

interface OpenAICompatibleClientLike {
  request(path: string, body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
  createChatCompletion(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
  createImage(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface OpenAICompatibleAdapterOptions {
  client: OpenAICompatibleClientLike;
  id?: string;
  providerIds?: string[];
  protocols?: string[];
  endpoints?: Partial<Record<"chat" | "image" | "video" | "audio", string>>;
  normalize?: (raw: unknown, context: ProviderAdapterContext) => ProviderExecutionResult;
}

export function createOpenAICompatibleAdapter(options: OpenAICompatibleAdapterOptions): ProviderAdapter {
  const providerIds = new Set(options.providerIds ?? []);
  const protocols = new Set(options.protocols ?? ["openai"]);
  return {
    id: options.id ?? "openai-compatible",
    supports(provider, model) {
      return providerIds.has(provider.id) || protocols.has(model.protocolOverride ?? provider.protocol);
    },
    async execute(context) {
      const body = { ...context.input, model: context.model.modelId };
      const requestOptions = context.signal ? { signal: context.signal } : undefined;
      const endpoint = options.endpoints?.[context.model.capability];
      let raw: unknown;
      if (endpoint) raw = await options.client.request(endpoint, body, requestOptions);
      else if (context.model.capability === "chat") raw = await options.client.createChatCompletion(body, requestOptions);
      else if (context.model.capability === "image") raw = await options.client.createImage(body, requestOptions);
      else throw new Error(`No OpenAI-compatible endpoint configured for capability: ${context.model.capability}`);
      if (options.normalize) return options.normalize(raw, context);
      return normalizeOpenAIResult(raw, context);
    }
  };
}

interface RunningHubClientLike {
  runTask(input: RunningHubRunInput): Promise<RunningHubRunResult>;
}

export interface RunningHubAdapterOptions {
  client: RunningHubClientLike;
  id?: string;
  providerIds?: string[];
  resolveRunInput?: (context: ProviderAdapterContext) => RunningHubRunInput;
}

export function createRunningHubAdapter(options: RunningHubAdapterOptions): ProviderAdapter {
  const providerIds = new Set(options.providerIds ?? []);
  return {
    id: options.id ?? "runninghub",
    supports(provider, model) {
      return (model.protocolOverride ?? provider.protocol) === "runninghub" || providerIds.has(provider.id);
    },
    async execute(context) {
      const runInput = options.resolveRunInput?.(context) ?? defaultRunningHubInput(context);
      const hostHeartbeat = runInput.onHeartbeat;
      const raw = await options.client.runTask({
        ...runInput,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
        onHeartbeat: async (patch) => {
          await hostHeartbeat?.(patch);
          const status = text(patch.upstreamStatus);
          const percent = parsePercent(patch.progress);
          const message = text(patch.upstreamMessage);
          await context.emitProgress({
            ...(status ? { status } : {}),
            ...(percent !== undefined ? { percent } : {}),
            ...(message ? { message } : {}),
            details: patch
          });
        }
      });
      return {
        status: "completed",
        providerId: context.provider.id,
        modelId: context.model.id,
        capability: context.model.capability,
        taskId: raw.upstreamTaskId,
        outputs: [
          ...raw.imageUrls.map((url) => ({ type: "image" as const, url })),
          ...raw.videoUrls.map((url) => ({ type: "video" as const, url })),
          ...raw.audioUrls.map((url) => ({ type: "audio" as const, url }))
        ],
        raw: raw.raw
      };
    }
  };
}

function defaultRunningHubInput(context: ProviderAdapterContext): RunningHubRunInput {
  const config = plainObject(plainObject(context.model.advancedConfig).runninghub ?? context.model.advancedConfig);
  const targetType = config.targetType === "app" ? "app" : "workflow";
  const runTargetId = text(config.runTargetId || config.appId || config.workflowId);
  if (!runTargetId) throw new Error(`RunningHub runTargetId is missing for model: ${context.model.id}`);
  const supplied = Array.isArray(context.input.nodeInfoList) ? context.input.nodeInfoList as RunningHubNodeInfoItem[] : undefined;
  const fieldMap = plainObject(config.fieldMap);
  const nodeInfoList = supplied ?? Object.entries(context.input).flatMap(([key, fieldValue]) => {
    const binding = plainObject(fieldMap[key]);
    const nodeId = text(binding.nodeId);
    const fieldName = text(binding.fieldName, key);
    return nodeId ? [{ nodeId, fieldName, fieldValue }] : [];
  });
  return {
    targetType,
    runTargetId,
    nodeInfoList,
    ...(text(config.appId) ? { appId: text(config.appId) } : {}),
    ...(text(config.workflowId) ? { workflowId: text(config.workflowId) } : {}),
    ...(text(config.instanceType) ? { instanceType: text(config.instanceType) } : {})
  };
}

function normalizeOpenAIResult(raw: unknown, context: ProviderAdapterContext): ProviderExecutionResult {
  const row = plainObject(raw);
  const outputs = extractOpenAIOutputs(row, context.model.capability);
  const usageRow = plainObject(row.usage);
  const usage = normalizeUsage(usageRow);
  return {
    status: "completed",
    providerId: context.provider.id,
    modelId: context.model.id,
    capability: context.model.capability,
    outputs: outputs.length > 0 ? outputs : [{ type: "json", data: raw }],
    ...(usage ? { usage } : {}),
    raw
  };
}

function extractOpenAIOutputs(row: Record<string, unknown>, capability: ProviderModelDefinition["capability"]): ProviderExecutionOutput[] {
  if (capability === "chat") {
    const choices = Array.isArray(row.choices) ? row.choices : [];
    return choices.flatMap((choice) => {
      const content = text(plainObject(plainObject(choice).message).content || plainObject(choice).text);
      return content ? [{ type: "text" as const, text: content }] : [];
    });
  }
  const data = Array.isArray(row.data) ? row.data : [];
  return data.flatMap((item) => {
    const value = plainObject(item);
    const url = text(value.url);
    const base64 = text(value.b64_json);
    if (url) return [{ type: capability === "image" ? "image" as const : capability, url }];
    if (base64 && capability === "image") return [{ type: "image" as const, url: `data:image/png;base64,${base64}`, mimeType: "image/png" }];
    return [];
  });
}

function normalizeUsage(value: Record<string, unknown>): ProviderExecutionUsage | undefined {
  const inputTokens = finiteNumber(value.prompt_tokens ?? value.input_tokens);
  const outputTokens = finiteNumber(value.completion_tokens ?? value.output_tokens);
  const totalTokens = finiteNumber(value.total_tokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  };
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "") {
  const result = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  return result.trim() || fallback;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parsePercent(value: unknown) {
  const number = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : undefined;
}
