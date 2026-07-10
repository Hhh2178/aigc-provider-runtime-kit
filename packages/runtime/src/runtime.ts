import { createProviderRegistry, type ProviderDefinition, type ProviderModelDefinition, type ValidationIssue } from "../../core/src/index.js";
import type { ProviderAdapter, ProviderExecutionInput, ProviderExecutionResult, ProviderRuntimeEvent, ProviderRuntimeHooks } from "./contracts.js";
import { validateProviderExecutionInput } from "./input-validation.js";

export type ProviderRuntimeErrorCode =
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "MODEL_NOT_FOUND"
  | "MODEL_DISABLED"
  | "MODEL_PROVIDER_MISMATCH"
  | "INPUT_INVALID"
  | "ADAPTER_NOT_FOUND"
  | "ADAPTER_FAILED"
  | "EXECUTION_ABORTED";

export class ProviderRuntimeError extends Error {
  readonly code: ProviderRuntimeErrorCode;
  readonly providerId: string | undefined;
  readonly modelId: string | undefined;
  readonly adapterId: string | undefined;
  readonly issues: ValidationIssue[];

  constructor(code: ProviderRuntimeErrorCode, message: string, options: { providerId?: string; modelId?: string; adapterId?: string; issues?: ValidationIssue[]; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ProviderRuntimeError";
    this.code = code;
    this.providerId = options.providerId;
    this.modelId = options.modelId;
    this.adapterId = options.adapterId;
    this.issues = options.issues ?? [];
  }
}

export function isProviderRuntimeError(value: unknown): value is ProviderRuntimeError {
  return value instanceof ProviderRuntimeError;
}

export interface CreateProviderRuntimeOptions {
  registry: ReturnType<typeof createProviderRegistry>;
  adapters: ProviderAdapter[];
  hooks?: ProviderRuntimeHooks;
  createExecutionId?: () => string;
}

export function createProviderRuntime(options: CreateProviderRuntimeOptions) {
  const adapters = [...options.adapters];
  const createExecutionId = options.createExecutionId ?? (() => crypto.randomUUID());

  async function execute(request: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    const executionId = createExecutionId();
    const startedAt = Date.now();
    let adapter: ProviderAdapter | undefined;
    await emit({ type: "execution.started", executionId, request });
    try {
      const provider = requireProvider(options.registry.getProvider(request.providerId), request);
      const model = requireModel(options.registry.getModel(request.modelId), request);
      validateRelationship(provider, model, request);
      const validation = validateProviderExecutionInput(model, request.input);
      if (!validation.valid) {
        throw new ProviderRuntimeError("INPUT_INVALID", "Provider execution input is invalid", { providerId: provider.id, modelId: model.id, issues: validation.issues });
      }
      await emit({ type: "execution.validated", executionId, provider, model });
      adapter = adapters.find((candidate) => candidate.supports(provider, model));
      if (!adapter) throw new ProviderRuntimeError("ADAPTER_NOT_FOUND", `No adapter supports provider ${provider.id} and model ${model.id}`, { providerId: provider.id, modelId: model.id });
      await emit({ type: "adapter.selected", executionId, adapterId: adapter.id });
      const control = executionControl(request.signal, request.timeoutMs);
      const signal = control.signal;
      if (signal?.aborted) {
        control.cleanup();
        throw aborted(request, signal.reason);
      }
      let result: ProviderExecutionResult;
      try {
        const execution = adapter.execute({
          provider,
          model,
          input: validation.value ?? request.input,
          emitProgress: async (progress) => emit({ type: "execution.progress", executionId, progress }),
          ...(signal ? { signal } : {}),
          ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
          ...(request.metadata ? { metadata: request.metadata } : {})
        });
        result = signal ? await raceWithSignal(execution, signal, request) : await execution;
      } catch (cause) {
        if (signal?.aborted) throw aborted(request, signal.reason);
        throw new ProviderRuntimeError("ADAPTER_FAILED", `Adapter ${adapter.id} failed`, { providerId: provider.id, modelId: model.id, adapterId: adapter.id, cause });
      } finally {
        control.cleanup();
      }
      const normalized = normalizeResult(result, provider, model);
      await emit({ type: "execution.succeeded", executionId, result: normalized, durationMs: Date.now() - startedAt });
      return normalized;
    } catch (error) {
      await emit({ type: "execution.failed", executionId, error, durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  async function emit(event: ProviderRuntimeEvent) {
    try {
      await options.hooks?.onEvent?.(event);
    } catch {
      // Observability hooks must not change execution behavior.
    }
  }

  return Object.freeze({ execute });
}

function requireProvider(provider: ProviderDefinition | undefined, request: ProviderExecutionInput) {
  if (!provider) throw new ProviderRuntimeError("PROVIDER_NOT_FOUND", `Provider not found: ${request.providerId}`, { providerId: request.providerId, modelId: request.modelId });
  if (!provider.enabled) throw new ProviderRuntimeError("PROVIDER_DISABLED", `Provider is disabled: ${provider.id}`, { providerId: provider.id, modelId: request.modelId });
  return provider;
}

function requireModel(model: ProviderModelDefinition | undefined, request: ProviderExecutionInput) {
  if (!model) throw new ProviderRuntimeError("MODEL_NOT_FOUND", `Model not found: ${request.modelId}`, { providerId: request.providerId, modelId: request.modelId });
  if (!model.enabled) throw new ProviderRuntimeError("MODEL_DISABLED", `Model is disabled: ${model.id}`, { providerId: request.providerId, modelId: model.id });
  return model;
}

function validateRelationship(provider: ProviderDefinition, model: ProviderModelDefinition, request: ProviderExecutionInput) {
  if (model.providerId !== provider.id) {
    throw new ProviderRuntimeError("MODEL_PROVIDER_MISMATCH", `Model ${model.id} does not belong to provider ${provider.id}`, { providerId: request.providerId, modelId: request.modelId });
  }
}

function normalizeResult(result: ProviderExecutionResult, provider: ProviderDefinition, model: ProviderModelDefinition): ProviderExecutionResult {
  if (!result || !Array.isArray(result.outputs)) {
    throw new ProviderRuntimeError("ADAPTER_FAILED", "Adapter returned an invalid result", { providerId: provider.id, modelId: model.id });
  }
  return {
    ...result,
    status: "completed",
    providerId: provider.id,
    modelId: model.id,
    capability: model.capability,
    outputs: [...result.outputs]
  };
}

function executionControl(signal: AbortSignal | undefined, timeoutMs: number | undefined) {
  if (!Number.isFinite(timeoutMs)) return { signal, cleanup: () => {} };
  const controller = new AbortController();
  const duration = Math.max(1, Math.round(timeoutMs as number));
  const timer = setTimeout(() => controller.abort(new Error(`Provider execution timed out after ${duration}ms`)), duration);
  return {
    signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    cleanup: () => clearTimeout(timer)
  };
}

function aborted(request: ProviderExecutionInput, cause: unknown) {
  return new ProviderRuntimeError("EXECUTION_ABORTED", "Provider execution aborted or timed out", { providerId: request.providerId, modelId: request.modelId, cause });
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal, request: ProviderExecutionInput): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted(request, signal.reason));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(aborted(request, signal.reason));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}
