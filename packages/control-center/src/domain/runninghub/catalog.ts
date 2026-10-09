import {
  buildRunningHubExecutionDescriptor,
  normalizeRunningHubInputSlots,
  type RhCatalogItem,
  type RhCatalogItemKind,
  type RhFieldDefinition,
  type RhInputSlotDefinition
} from "aigc-provider-runtime-kit/runninghub";
import type { RhTaskCapability } from "aigc-provider-runtime-kit/runninghub";
import { safeText } from "../../util.js";

export type { RhCatalogItemKind, RhFieldDefinition, RhInputSlotDefinition, RhTaskCapability };

export interface RhCatalogGroup {
  id: string;
  providerId: string;
  name: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface RhOutputDefinition {
  key: string;
  label: string;
  kind: string;
  path?: string;
  multiple?: boolean;
}

export interface RhExecutionRules {
  submitMode: "direct";
  targetType: "app" | "workflow";
  method: "POST";
  endpoint: string;
  resultPath: string;
  errorPath: string;
  acceptsUploads: boolean;
  acceptsRemoteUrls: boolean;
  outputKind: "remote-url";
  supportsMultipleOutputs: boolean;
  pollingStrategy: "none" | "fixed-interval";
  pollingIntervalMs: number;
  pollingTimeoutMs?: number | undefined;
  retryable: boolean;
}

/** Stored (admin) entry inside provider rhApps / rhWorkflows columns. */
export interface RhCatalogEntry {
  id: string;
  title: string;
  note?: string | undefined;
  thumbnail?: string | undefined;
  enabled: boolean;
  kind?: RhCatalogItemKind | undefined;
  pageId?: string | undefined;
  appId?: string | undefined;
  workflowId?: string | undefined;
  runTargetId?: string | undefined;
  taskCapability?: RhTaskCapability | undefined;
  workflowJson?: string | undefined;
  fields?: RhFieldDefinition[] | undefined;
  allowsEmptyInputs?: boolean | undefined;
  groupId?: string | undefined;
  parameterSchema?: string | undefined;
  outputSchema?: RhOutputDefinition[] | undefined;
  executionRules?: RhExecutionRules | undefined;
  testPayload?: string | undefined;
}

export interface RhAdminCatalogItem extends RhCatalogItem, RhAdminMetadata {
  id: string;
}

export interface RhAdminMetadata {
  providerName?: string;
  providerBaseUrl?: string;
  groupName?: string | undefined;
  note?: string;
  thumbnail?: string;
  groupId?: string | undefined;
  workflowJson?: string;
  parameterSchema?: string;
  outputSchema?: RhOutputDefinition[];
  executionRules?: RhExecutionRules;
  testPayload?: string;
}

export function safeRunningHubJsonText(value: unknown, fallback = "{}") {
  const text = String(value ?? "").trim().slice(0, 200_000) || fallback;
  if (!text) return fallback;
  try {
    JSON.parse(text);
    return text;
  } catch {
    throw new Error("RunningHub JSON 字段必须是合法 JSON");
  }
}

export function safeRunningHubObjectJsonText(value: unknown, fallback = "{}") {
  const text = safeRunningHubJsonText(value, fallback);
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("参数 Schema 必须是 JSON 对象，不能是数组、字符串或数字");
  }
  return JSON.stringify(parsed, null, 2);
}

export function preserveRunningHubJsonText(value: unknown, fallback = "{}") {
  try {
    return safeRunningHubJsonText(value, fallback);
  } catch {
    return safeText(value, fallback, 200_000);
  }
}

export function preserveRunningHubObjectJsonText(value: unknown, fallback = "{}") {
  try {
    return safeRunningHubObjectJsonText(value, fallback);
  } catch {
    return fallback;
  }
}

export function normalizeRunningHubGroups(value: unknown, providerId: string, now = Date.now()): RhCatalogGroup[] {
  const rows = Array.isArray(value) ? value : [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  return rows
    .map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const id = safeText(row.id, "", 120);
      const name = safeText(row.name, "", 120);
      const nameKey = name.toLowerCase();
      if (!id || !name || seenIds.has(id) || seenNames.has(nameKey)) return null;
      seenIds.add(id);
      seenNames.add(nameKey);
      const createdAt = Number(row.createdAt) || now;
      return {
        id,
        providerId,
        name,
        description: safeText(row.description, "", 1000),
        enabled: row.enabled !== false,
        sortOrder: Math.max(0, Math.floor(Number(row.sortOrder) || 0)),
        createdAt,
        updatedAt: Number(row.updatedAt) || createdAt
      } satisfies RhCatalogGroup;
    })
    .filter(Boolean)
    .sort((left, right) =>
      left!.sortOrder - right!.sortOrder
      || left!.name.localeCompare(right!.name, "zh-CN")
      || left!.id.localeCompare(right!.id)) as RhCatalogGroup[];
}

export function parseRunningHubRef(value: unknown) {
  const text = safeText(value);
  // Example AI App doc pattern: call-api/api-detail/1978404642654670849?apiType=4
  const apiDetailAppMatch = text.match(/call-api\/api-detail\/([0-9A-Za-z_-]+)\?apiType=4/i);
  if (apiDetailAppMatch) return { type: "app" as const, id: apiDetailAppMatch[1] };
  const openapiMatch = text.match(/\/(?:openapi\/v2\/)?run\/(ai-app|workflow)\/([0-9A-Za-z_-]+)/i);
  if (openapiMatch) {
    const type = openapiMatch[1]?.toLowerCase() === "ai-app" ? ("app" as const) : ("workflow" as const);
    return { type, id: openapiMatch[2] ?? "" };
  }
  const match = text.match(/\/run\/(ai-app|workflow)\/([0-9A-Za-z_-]+)/i);
  if (match) {
    const type = match[1]?.toLowerCase() === "ai-app" ? ("app" as const) : ("workflow" as const);
    return { type, id: match[2] ?? "" };
  }
  if (/^workflow-[0-9A-Za-z_-]+$/i.test(text)) return { type: "workflow" as const, id: text };
  return null;
}

export function normalizeRunningHubFieldDefinitions(value: unknown): RhFieldDefinition[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const nodeId = safeText(row.nodeId, "", 240);
      const fieldName = safeText(row.fieldName, "", 240);
      if (!nodeId || !fieldName) return null;
      const fieldValue = normalizePrimitive(row.fieldValue);
      const defaultValue = normalizePrimitive(row.defaultValue);
      const options = normalizeOptions(row.options || row.fieldData || row.list || row.values);
      return {
        nodeId,
        fieldName,
        label: safeText(row.label, "", 240),
        displayLabel: safeText(row.displayLabel || row.title, "", 240),
        description: safeText(row.description, "", 2000),
        fieldType: safeText(row.fieldType, "", 240),
        valueType: safeText(row.valueType, "", 240),
        placeholder: safeText(row.placeholder, "", 1000),
        ...(row.required === undefined ? {} : { required: Boolean(row.required) }),
        ...(fieldValue !== undefined ? { fieldValue } : {}),
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(options ? { options } : {})
      } satisfies RhFieldDefinition;
    })
    .filter(Boolean) as RhFieldDefinition[];
}

export function normalizeRunningHubCatalogItem(value: unknown, kind: RhCatalogItemKind): RhCatalogEntry | null {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const parsed = parseRunningHubRef(row.id || row.appId || row.workflowId || row.runTargetId || "");
  const id = safeText(parsed?.id || row.id || row.appId || row.workflowId || row.runTargetId);
  if (!id) return null;
  const pageId = safeText(row.pageId || row.id || (kind === "app" ? row.appId : row.workflowId) || id);
  const runTargetId = safeText(row.runTargetId || (kind === "app" ? row.appId : row.workflowId) || id);
  const taskCapabilityText = safeText(row.taskCapability).toLowerCase();
  const taskCapability =
    taskCapabilityText === "image" || taskCapabilityText === "audio" || taskCapabilityText === "chat"
      ? taskCapabilityText as RhTaskCapability
      : "video";
  return {
    id,
    kind,
    pageId,
    appId: kind === "app" ? safeText(row.appId || runTargetId || id) : safeText(row.appId),
    workflowId: kind === "workflow" ? safeText(row.workflowId || runTargetId || id) : safeText(row.workflowId),
    runTargetId,
    taskCapability,
    title: safeText(row.title, kind === "app" ? `AI 应用 ${id.slice(-6)}` : `工作流 ${id.slice(-6)}`),
    note: safeText(row.note),
    thumbnail: safeText(row.thumbnail),
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    ...(safeText(row.groupId, "", 120) ? { groupId: safeText(row.groupId, "", 120) } : {}),
    workflowJson: normalizeOptionalJsonText(row.workflowJson),
    fields: normalizeRunningHubFieldDefinitions(row.fields),
    allowsEmptyInputs: row.allowsEmptyInputs === true,
    parameterSchema: normalizeOptionalJsonText(row.parameterSchema) || "{}",
    outputSchema: normalizeOutputDefinitions(row.outputSchema),
    executionRules: normalizeRunningHubExecutionRules(row.executionRules, kind, runTargetId),
    testPayload: normalizeOptionalJsonText(row.testPayload) || "{}"
  };
}

export function normalizeRunningHubCatalogItems(value: unknown, kind: RhCatalogItemKind, validGroupIds?: Set<string>): RhCatalogEntry[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const normalized = normalizeRunningHubCatalogItem(item, kind);
      if (!normalized || !validGroupIds || !normalized.groupId || validGroupIds.has(normalized.groupId)) return normalized;
      return null;
    })
    .filter(Boolean) as RhCatalogEntry[];
}

export function runningHubCatalogId(providerId: string, kind: RhCatalogItemKind, entryId: string) {
  return `${providerId}:${kind}:${entryId}`;
}

export function toPublicRunningHubCatalogItem(provider: { id: string; name: string; baseUrl: string; rhGroups?: RhCatalogGroup[] | undefined }, entry: RhCatalogEntry) {
  const fields = normalizeRunningHubFieldDefinitions(entry.fields);
  const item: RhAdminCatalogItem = {
    id: entry.id,
    catalogId: runningHubCatalogId(provider.id, entry.kind || "workflow", entry.id),
    providerId: provider.id,
    kind: entry.kind || "workflow",
    title: entry.title,
    enabled: entry.enabled,
    inputSlots: normalizeRunningHubInputSlots(normalizeRunningHubFieldDefinitions(entry.fields)),
    execution: buildRunningHubExecutionDescriptor({
      kind: entry.kind || "workflow",
      pageId: entry.pageId ?? entry.id,
      appId: entry.appId ?? "",
      workflowId: entry.workflowId ?? "",
      runTargetId: entry.runTargetId ?? entry.id,
      taskCapability: entry.taskCapability ?? "video",
      fields: normalizeRunningHubFieldDefinitions(entry.fields)
    }),
    pageId: entry.pageId || entry.id,
    appId: entry.appId || "",
    workflowId: entry.workflowId || "",
    runTargetId: entry.runTargetId || entry.workflowId || entry.appId || entry.id,
    taskCapability: entry.taskCapability === "image" || entry.taskCapability === "audio" || entry.taskCapability === "chat"
      ? entry.taskCapability
      : "video",
    allowsEmptyInputs: entry.allowsEmptyInputs === true,
    fields,
    providerName: provider.name,
    providerBaseUrl: provider.baseUrl,
    ...(entry.groupId ? { groupId: entry.groupId } : {}),
    ...(provider.rhGroups?.find((group) => group.id === entry.groupId)?.name
      ? { groupName: provider.rhGroups.find((group) => group.id === entry.groupId)!.name } : {}),
    note: entry.note || "",
    thumbnail: entry.thumbnail || "",
    workflowJson: entry.workflowJson || "",
    parameterSchema: normalizeOptionalJsonText(entry.parameterSchema) || "{}",
    outputSchema: normalizeOutputDefinitions(entry.outputSchema)
  };
  return item;
}

export function toAdminRunningHubCatalogItem(provider: { id: string; name: string; baseUrl: string; rhGroups?: RhCatalogGroup[] | undefined }, entry: RhCatalogEntry): RhAdminCatalogItem {
  const publicItem = toPublicRunningHubCatalogItem(provider, entry);
  return {
    ...publicItem,
    parameterSchema: entry.parameterSchema || "{}",
    outputSchema: normalizeOutputDefinitions(entry.outputSchema),
    executionRules: normalizeRunningHubExecutionRules(entry.executionRules, entry.kind || "workflow", entry.runTargetId || entry.id),
    testPayload: entry.testPayload || "{}"
  };
}

export function runningHubDefaultEndpoint(kind: "app" | "workflow", targetId: string) {
  return kind === "app" ? `/runninghub/app/${targetId}/run` : `/runninghub/workflow/${targetId}/run`;
}

export function isRunningHubDefaultEndpoint(kind: "app" | "workflow", targetId: string, endpoint: string) {
  return endpoint.trim() === runningHubDefaultEndpoint(kind, targetId);
}

export function normalizeOutputDefinitions(value: unknown): RhOutputDefinition[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const key = safeText(row.key);
      const label = safeText(row.label);
      if (!key || !label) return null;
      return {
        key,
        label,
        kind: safeText(row.kind, "image").toLowerCase() || "image",
        path: safeText(row.path),
        multiple: row.multiple === undefined ? true : Boolean(row.multiple)
      } satisfies RhOutputDefinition;
    })
    .filter(Boolean) as RhOutputDefinition[];
}

export function normalizeRunningHubExecutionRules(value: unknown, kind: "app" | "workflow", targetId: string): RhExecutionRules {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const pollingStrategy = safeText(row.pollingStrategy).toLowerCase() === "fixed-interval" ? "fixed-interval" as const : "none" as const;
  const timeout = Number(row.pollingTimeoutMs);
  return {
    submitMode: "direct",
    targetType: kind,
    method: "POST",
    endpoint: safeText(row.endpoint, runningHubDefaultEndpoint(kind, targetId), 1000),
    resultPath: safeText(row.resultPath, "data", 240),
    errorPath: safeText(row.errorPath, "message", 240),
    acceptsUploads: row.acceptsUploads === undefined ? true : Boolean(row.acceptsUploads),
    acceptsRemoteUrls: row.acceptsRemoteUrls === undefined ? true : Boolean(row.acceptsRemoteUrls),
    outputKind: "remote-url",
    supportsMultipleOutputs: row.supportsMultipleOutputs === undefined ? true : Boolean(row.supportsMultipleOutputs),
    pollingStrategy,
    pollingIntervalMs: Number.isFinite(Number(row.pollingIntervalMs)) ? Math.max(0, Number(row.pollingIntervalMs)) : 0,
    ...(Number.isFinite(timeout) && timeout > 0 ? { pollingTimeoutMs: timeout } : {}),
    retryable: Boolean(row.retryable)
  };
}

export function hasRunningHubExplicitEmptyNodeInfoList(testPayload: unknown) {
  const text = typeof testPayload === "string" ? testPayload.trim() : "";
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const nodeInfoList = (parsed as Record<string, unknown>).nodeInfoList;
    return Array.isArray(nodeInfoList) && nodeInfoList.length === 0;
  } catch {
    return false;
  }
}

export function assertRunningHubTargetConsistency(kind: "app" | "workflow", row: { runTargetId?: string | undefined; appId?: string | undefined; workflowId?: string | undefined }) {
  const runTargetId = safeText(row.runTargetId);
  const appId = safeText(row.appId);
  const workflowId = safeText(row.workflowId);
  if (kind === "app") {
    if (workflowId) throw new Error("当前条目已识别为 AI 应用，不能继续保留 workflowId");
    if (!runTargetId && !appId) throw new Error("AI 应用缺少 runTargetId/appId");
    return;
  }
  if (!runTargetId && !workflowId) throw new Error("工作流缺少 runTargetId/workflowId");
  if (appId && !workflowId) throw new Error("当前条目已识别为工作流，不能继续保留 appId");
}

export function assertRunningHubEntryCanBeEnabled(entry: {
  enabled: boolean;
  kind?: "app" | "workflow" | undefined;
  title?: string | undefined;
  catalogId?: string | undefined;
  fields?: RhFieldDefinition[] | undefined;
  testPayload?: string | undefined;
}) {
  if (!entry.enabled) return;
  if (normalizeRunningHubFieldDefinitions(entry.fields).length > 0) return;
  if (hasRunningHubExplicitEmptyNodeInfoList(entry.testPayload)) return;
  const itemLabel = safeText(entry.title || entry.catalogId, entry.kind === "app" ? "RunningHub AI 应用" : "RunningHub 工作流");
  throw new Error(`${itemLabel} 仍缺少输入槽定义，不能启用。请至少补齐一个包含 nodeId 和 fieldName 的输入槽，或先保存为停用草稿。`);
}

export function createRhCatalogEntryId(kind: "app" | "workflow", randomToken: (bytes: number) => string) {
  return `${kind}-${Date.now().toString(36)}-${randomToken(4)}`;
}

export function createBlankRhCatalogEntry(kind: "app" | "workflow", titleText: string, randomToken: (bytes: number) => string): RhCatalogEntry {
  const id = createRhCatalogEntryId(kind, randomToken);
  return {
    id,
    kind,
    title: titleText,
    note: "",
    thumbnail: "",
    enabled: false,
    pageId: id,
    appId: kind === "app" ? id : "",
    workflowId: kind === "workflow" ? id : "",
    runTargetId: id,
    taskCapability: kind === "app" ? "image" : "video"
  };
}

function normalizePrimitive(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = safeText(value);
  return text || undefined;
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) return item;
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        if (typeof row.value === "number" && Number.isFinite(row.value)) return row.value;
        if (typeof row.value === "string") return row.value.trim();
        if (typeof row.label === "string") return row.label.trim();
        if (typeof row.name === "string") return row.name.trim();
      }
      return "";
    })
    .filter((item) => item !== "" && item !== null && item !== undefined);
  return options.length > 0 ? options : undefined;
}

function normalizeOptionalJsonText(value: unknown) {
  const text = safeText(value, "", 200_000);
  if (!text) return "";
  try {
    JSON.parse(text);
    return text;
  } catch {
    return "";
  }
}
