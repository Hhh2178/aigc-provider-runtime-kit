import type {
  RhCatalogItemKind,
  RhCatalogSource,
  RhExecutionDescriptor,
  RhFieldDefinition,
  RhInputSlotDefinition,
  RhSlotCardinality,
  RhSlotDataType,
  RhTaskCapability
} from "./types.js";

export function normalizeRunningHubInputSlots(fields: RhFieldDefinition[] | undefined): RhInputSlotDefinition[] {
  const list = Array.isArray(fields) ? fields : [];
  return list
    .map((field) => {
      const nodeId = safeText(field.nodeId);
      const fieldName = safeText(field.fieldName);
      if (!nodeId || !fieldName) return null;
      const dataType = inferSlotDataType(field);
      const options = Array.isArray(field.options)
        ? field.options.filter((item) => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)))
        : undefined;
      const defaultValue = normalizePrimitive(field.defaultValue);
      const manualValue = normalizePrimitive(field.fieldValue);
      return {
        key: `${nodeId}:${fieldName}`,
        name: fieldName,
        title: safeText(field.displayLabel || field.label, fieldName),
        description: safeText(field.description),
        dataType,
        cardinality: inferSlotCardinality(field),
        required: Boolean(field.required),
        supportsConnection: true,
        supportsManualInput: dataType === "text" || dataType === "json",
        supportsUpload: dataType === "image" || dataType === "video" || dataType === "audio",
        bindingTarget: {
          nodeId,
          fieldName,
          path: `${nodeId}.${fieldName}`
        },
        placeholder: safeText(field.placeholder),
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(manualValue !== undefined ? { manualValue } : {}),
        ...(options && options.length > 0 ? { options } : {})
      } satisfies RhInputSlotDefinition;
    })
    .filter(Boolean) as RhInputSlotDefinition[];
}

export function buildRunningHubExecutionDescriptor(item: RhCatalogSource): RhExecutionDescriptor {
  const kind: RhCatalogItemKind = item.kind === "app" ? "app" : "workflow";
  const pageId = safeText(item.pageId || item.appId || item.workflowId || item.runTargetId);
  const appId = kind === "app" ? safeText(item.appId || item.runTargetId || item.pageId) : "";
  const workflowId = kind === "workflow" ? safeText(item.workflowId || item.runTargetId || item.pageId) : "";
  const runTargetId = safeText(item.runTargetId || (kind === "app" ? appId : workflowId));
  const taskCapability = normalizeTaskCapability(item.taskCapability);
  return {
    submit: {
      mode: "direct",
      targetType: kind,
      targetId: runTargetId,
      ...(pageId ? { pageId } : {}),
      ...(appId ? { appId } : {}),
      ...(workflowId ? { workflowId } : {}),
      taskCapability,
      submitMode: kind === "app" ? "ai-app" : "openapi-v2-workflow",
      queryMode: kind === "app" ? "outputs" : "openapi-v2-query",
      endpoint: kind === "app" ? `/runninghub/app/${runTargetId}/run` : `/runninghub/workflow/${runTargetId}/run`,
      method: "POST"
    },
    assetHandling: {
      input: {
        acceptsUploads: true,
        acceptsRemoteUrls: true,
        requiresPreSignedUrls: false
      },
      output: {
        resultKind: "remote-url",
        supportsMultiple: true
      }
    },
    polling: {
      strategy: "fixed-interval",
      intervalMs: 5000
    },
    result: {
      mode: "inline",
      payloadPath: "data",
      errorPath: "message"
    },
    errorHandling: {
      surface: "provider-message",
      retryable: false,
      messagePath: "message"
    }
  };
}

export function normalizeRunningHubCatalogItem(source: RhCatalogSource) {
  const kind = source.kind === "app" ? "app" : "workflow";
  const execution = buildRunningHubExecutionDescriptor(source);
  const inputSlots = normalizeRunningHubInputSlots(source.fields);
  return {
    catalogId: safeText(source.catalogId, `${kind}:${execution.submit.targetId}`),
    kind,
    title: safeText(source.title, execution.submit.targetId),
    enabled: true,
    providerId: safeText(source.providerId, "runninghub"),
    inputSlots,
    execution,
    pageId: safeText(source.pageId),
    appId: safeText(source.appId),
    workflowId: safeText(source.workflowId),
    runTargetId: execution.submit.targetId,
    taskCapability: execution.submit.taskCapability,
    allowsEmptyInputs: Boolean(source.allowsEmptyInputs),
    fields: Array.isArray(source.fields) ? source.fields : []
  };
}

function inferSlotDataType(field: RhFieldDefinition): RhSlotDataType {
  const combined = `${safeText(field.valueType)} ${safeText(field.fieldType)}`.toLowerCase();
  if (/image|img|picture/.test(combined)) return "image";
  if (/video/.test(combined)) return "video";
  if (/audio|voice|sound/.test(combined)) return "audio";
  if (/json|object|array/.test(combined)) return "json";
  return "text";
}

function inferSlotCardinality(field: RhFieldDefinition): RhSlotCardinality {
  const combined = `${safeText(field.valueType)} ${safeText(field.fieldType)}`.toLowerCase();
  return /array|list|multi|multiple/.test(combined) ? "multiple" : "single";
}

function normalizeTaskCapability(value: unknown): RhTaskCapability {
  return value === "image" || value === "audio" || value === "chat" ? value : "video";
}

function normalizePrimitive(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = safeText(value);
  return text || undefined;
}

function safeText(value: unknown, fallback = "") {
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  return text.trim() || fallback;
}
