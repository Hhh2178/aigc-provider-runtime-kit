import { validateProviderExecutionInput, type ProviderModelDefinition } from "aigc-provider-runtime-kit/runtime";
import type { TaskCapability } from "./task-machine.js";
import type { ModelRecord, ProviderRecord } from "./types.js";
import { normalizeProviderProtocol } from "./protocol-catalog.js";
import {
  normalizeRunningHubCatalogItem,
  runningHubCatalogId
} from "./runninghub/catalog.js";
import { safeLongText, safeSlug, safeText, plainObject } from "../util.js";

const PROTOCOL_ADAPTER_SUPPORT = new Set([
  "openai",
  "modelscope",
  "custom",
  "runninghub"
]);

export interface SubmitTaskInput {
  capability: TaskCapability;
  body: Record<string, unknown>;
}

export interface ResolvedTask {
  provider: ProviderRecord;
  model: ModelRecord | null;
  protocol: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | undefined;
}

export interface TaskSubmitDeps {
  findProviderRecordById(providerId: string): Promise<ProviderRecord | null>;
  findModelRecordById(modelRecordId: string): Promise<ModelRecord | null>;
  findEnabledEnabledModel(
    capability: TaskCapability,
    providerId: string,
    modelId: string
  ): Promise<{ provider: ProviderRecord; model: ModelRecord } | null>;
}

export class TaskSubmitError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "TaskSubmitError";
    this.statusCode = statusCode;
  }
}

/**
 * Submit-time validation and normalization shared by /api/task routes and future
 * host integrations. Produces the canonical task payload; the worker consumes
 * exactly this payload.
 */
export async function resolveTaskSubmit(input: SubmitTaskInput, deps: TaskSubmitDeps): Promise<ResolvedTask> {
  const body = plainObject(input.body);
  const capability = input.capability;

  let providerId = safeSlug(body.providerId, "");
  let modelRecordId = safeText(body.modelRecordId);
  let modelId = safeText(body.modelId ?? body.model);
  let provider: ProviderRecord | null = null;
  let model: ModelRecord | null = null;

  if (modelRecordId) {
    model = await deps.findModelRecordById(modelRecordId);
    if (!model) throw new TaskSubmitError(404, `模型记录不存在: ${modelRecordId}`);
    provider = await deps.findProviderRecordById(model.providerId);
  } else if (modelId && providerId) {
    const pair = await deps.findEnabledEnabledModel(capability, providerId, modelId);
    if (!pair) throw new TaskSubmitError(404, `未找到已启用的模型 ${providerId}/${modelId}`);
    provider = pair.provider;
    model = pair.model;
  } else if (providerId) {
    // RunningHub submissions route by catalogId and need no model record at all.
    provider = await deps.findProviderRecordById(providerId);
    if (!provider) throw new TaskSubmitError(404, "Provider 不存在");
    if (String(provider.protocol ?? "") !== "runninghub") {
      throw new TaskSubmitError(400, "缺少 providerId+modelId 或 modelRecordId");
    }
  } else {
    throw new TaskSubmitError(400, "缺少 providerId+modelId 或 modelRecordId");
  }
  if (!provider) throw new TaskSubmitError(404, "Provider 不存在");
  if (!provider.enabled) throw new TaskSubmitError(409, `Provider 未启用: ${provider.id}`);
  if (model) {
    if (!model.enabled) throw new TaskSubmitError(409, `模型未启用: ${model.id}`);
    if (model.providerId !== provider.id) throw new TaskSubmitError(409, "模型与 Provider 不匹配");
  }

  const protocol = normalizeProviderProtocol(String(model?.protocolOverride ?? "") || provider.protocol);
  if (protocol !== "runninghub" && !model) {
    throw new TaskSubmitError(404, "模型记录不存在");
  }
  if (protocol !== "runninghub" && !PROTOCOL_ADAPTER_SUPPORT.has(protocol)) {
    throw new TaskSubmitError(409, `协议适配器尚未移植: ${protocol}（阶段 2 将接入 apimart/aicopy/grsai 等协议）`);
  }
  if (model && protocol !== "runninghub" && model.capability !== capability) {
    throw new TaskSubmitError(409, `模型能力 ${model.capability} 与任务类型 ${capability} 不匹配`);
  }

  // Parameter schema validation through the kit runtime validator; RunningHub
  // catalog targets carry their own slot contract and skip schema validation.
  const validation = validateProviderExecutionInput(
    model ? toKitModelDefinition(model) : emptyKitModelDefinition(provider),
    plainObject(body.input)
  );
  if (!validation.valid) {
    const detail = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new TaskSubmitError(400, `任务参数校验失败: ${detail}`);
  }
  const inputParams = validation.value ?? {};

  const prompt = safeLongText((inputParams.prompt as string) ?? body.prompt, "", 8000);
  if (protocol !== "runninghub" && capability !== "chat" && !prompt) {
    throw new TaskSubmitError(400, "缺少 prompt");
  }

  const runninghub = protocol === "runninghub"
    ? resolveRunningHubCatalogTarget(body, provider)
    : null;

  const payload: Record<string, unknown> = {
    capability,
    protocol,
    prompt,
    input: inputParams,
    idempotencyKey: safeText(body.idempotencyKey) || undefined,
    ...(runninghub ? { runninghub } : {}),
    timeoutMs: clampTimeout(body.timeoutMs),
    callbackUrl: safeText(body.callbackUrl) || undefined
  };

  return {
    provider,
    model,
    protocol,
    payload,
    idempotencyKey: safeText(body.idempotencyKey) || undefined
  };
}

function emptyKitModelDefinition(provider: ProviderRecord): ProviderModelDefinition {
  return {
    id: "runninghub-catalog",
    providerId: provider.id,
    modelId: "runninghub",
    displayName: "RunningHub catalog entry",
    capability: "video",
    enabled: true,
    parameterSchema: {}
  };
}

function toKitModelDefinition(model: ModelRecord): ProviderModelDefinition {
  const schema = safeJson(model.parameterSchema) as ProviderModelDefinition["parameterSchema"];
  return {
    id: model.id,
    providerId: model.providerId,
    modelId: model.modelId,
    displayName: model.displayName,
    capability: model.capability,
    enabled: model.enabled,
    ...(schema ? { parameterSchema: schema } : {})
  };
}

function safeJson(value: unknown) {
  if (typeof value !== "string") return plainObject(value);
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function clampTimeout(value: unknown) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return 15 * 60_000;
  return Math.min(12 * 60 * 60_000, Math.max(1000, Math.floor(timeout)));
}

export interface ResolvedRunningHubTarget {
  providerId: string;
  catalogId: string;
  kind: "app" | "workflow";
  runTargetId: string;
  taskCapability: "image" | "video" | "audio" | "chat";
  submitMode: "ai-app" | "openapi-v2-workflow";
  nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: unknown }>;
  pollIntervalMs: number;
  timeoutMs: number;
}

/**
 * Resolves the RunningHub catalog entry from either an explicit catalogId or the
 * provider's unique enabled entry, and maps the caller's input map to
 * nodeInfoList slots through the entry's stored field definitions.
 */
function resolveRunningHubCatalogTarget(body: Record<string, unknown>, provider: ProviderRecord): ResolvedRunningHubTarget {
  const source = plainObject(body.runninghub);
  const desiredCatalogId = safeText(source.catalogId);
  const entries = collectEntries(provider);

  function collectEntries(p: ProviderRecord) {
    const collected: Array<{ entry: NonNullable<ReturnType<typeof normalizeRunningHubCatalogItem>>; catalogId: string }> = [];
    for (const kind of ["app", "workflow"] as const) {
      for (const item of Array.isArray(kind === "app" ? p.rhApps : p.rhWorkflows) ? (kind === "app" ? p.rhApps : p.rhWorkflows) as unknown[] : []) {
        const entry = normalizeRunningHubCatalogItem(item, kind);
        if (!entry) continue;
        collected.push({ entry, catalogId: runningHubCatalogId(p.id, kind, entry.id) });
      }
    }
    return collected;
  }

  if (!entries.length) throw new TaskSubmitError(409, `Provider ${provider.id} 没有 RunningHub 目录条目`);
  let chosen: RhEntryLike = null;
  if (desiredCatalogId) {
    chosen = entries.find((item) => item.catalogId === desiredCatalogId || item.entry.id === desiredCatalogId) ?? null;
    if (!chosen) throw new TaskSubmitError(404, `RunningHub 条目不存在: ${desiredCatalogId}`);
  } else {
    throw new TaskSubmitError(400, "RunningHub 任务需要 runninghub.catalogId");
  }
  if (!chosen) throw new TaskSubmitError(404, "未选择 RunningHub 条目");
  const entry = chosen.entry;
  if (!entry.enabled) throw new TaskSubmitError(409, `RunningHub 条目未启用: ${entry.title || entry.id}`);

  const provided = plainObject(source.input);
  const valueByKey = (key: string, name: string) => {
    const candidates = [provided[key], provided[name]];
    return candidates.find((candidate) => candidate !== undefined);
  };

  const fields = Array.isArray(entry.fields) ? entry.fields : [];
  const nodeInfoList = fields.flatMap((field) => {
    const nodeId = safeText(field.nodeId);
    const fieldName = safeText(field.fieldName);
    if (!nodeId || !fieldName) return [];
    const raw = valueByKey(`${nodeId}:${fieldName}`, fieldName);
    const resolved = raw !== undefined ? raw : field.defaultValue !== undefined ? field.defaultValue : field.fieldValue;
    return [{ nodeId, fieldName, fieldValue: resolved }];
  });
  for (const field of fields) {
    const required = field.required === true;
    if (!required) continue;
    const nodeId = safeText(field.nodeId);
    const fieldName = safeText(field.fieldName);
    const slot = nodeInfoList.find((slot) => slot.nodeId === nodeId && slot.fieldName === fieldName);
    const empty = slot === undefined || slot.fieldValue === undefined || slot.fieldValue === null || String(slot.fieldValue) === "";
    if (empty) throw new TaskSubmitError(400, `缺少必填输入槽 ${nodeId}:${fieldName}`);
  }

  const kind = entry.kind === "app" ? "app" : "workflow";
  return {
    providerId: provider.id,
    catalogId: chosen.catalogId,
    kind,
    runTargetId: safeText(entry.runTargetId || (kind === "app" ? entry.appId : entry.workflowId) || entry.id),
    taskCapability: entry.taskCapability ?? "video",
    submitMode: kind === "app" ? "ai-app" : "openapi-v2-workflow",
    nodeInfoList,
    pollIntervalMs: 5000,
    timeoutMs: clampTimeout(source.timeoutMs ?? body.timeoutMs)
  };
}

type RhEntryLike = { entry: NonNullable<ReturnType<typeof normalizeRunningHubCatalogItem>>; catalogId: string } | null;
