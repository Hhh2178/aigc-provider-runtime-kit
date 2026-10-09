import type { RhCatalogItemKind, RhFieldDefinition, RhTaskCapability } from "aigc-provider-runtime-kit/runninghub";
import {
  parseRunningHubRef,
  type RhExecutionRules,
  type RhOutputDefinition,
  normalizeOutputDefinitions,
  normalizeRunningHubExecutionRules,
  runningHubDefaultEndpoint
} from "./catalog.js";
import { safeLongText, safeText } from "../../util.js";

export interface RhAnalyzeInput {
  providerId?: string;
  kind?: "app" | "workflow";
  sourceUrl?: string;
  pageId?: string;
  runTargetId?: string;
  docUrl?: string;
  requestExample?: string;
  responseExample?: string;
  notes?: string;
}

export interface RhAnalyzeSection {
  key: string;
  title: string;
  description: string;
  payload: unknown;
}

export interface RhAnalyzeDraft {
  summary: string;
  detectedKind?: "app" | "workflow";
  detectedTargetId: string;
  autoSwitchMessage: string;
  sections: RhAnalyzeSection[];
  warnings: string[];
}

export function analyzeRunningHubCatalogDraft(input: RhAnalyzeInput): RhAnalyzeDraft {
  const requestedKind = input.kind === "app" ? "app" : "workflow";
  const requestExampleObject = parseRhExampleObject(input.requestExample);
  const responseExampleObject = parseRhExampleObject(input.responseExample);
  const detectedTarget = detectRhTarget({
    docUrl: safeText(input.docUrl),
    sourceUrl: safeText(input.sourceUrl),
    runTargetId: safeText(input.runTargetId),
    pageId: safeText(input.pageId),
    requestExample: requestExampleObject,
    requestedKind
  });
  const kind = detectedTarget.kind === "app" ? "app" : requestedKind;
  const referenceTargetId = safeText(detectedTarget.targetId);
  const requestExampleRunTargetId = extractRunTargetIdFromExample(kind, requestExampleObject);
  const pageId = safeText(
    input.pageId
    || extractPageIdFromExample(requestExampleObject)
    || referenceTargetId
  );
  const runTargetId = safeText(
    referenceTargetId || input.runTargetId || requestExampleRunTargetId || detectedTarget.targetId,
    pageId || `rh-${Date.now().toString(36)}`
  );
  const capabilityText = [input.docUrl, input.sourceUrl, input.notes, input.requestExample, input.responseExample]
    .map((item) => safeText(item).toLowerCase())
    .join("\n");
  const requestExampleFields = buildFieldsFromRequestExample(requestExampleObject);
  const taskCapability: RhTaskCapability = /audio/.test(capabilityText)
    ? "audio"
    : /chat|text/.test(capabilityText)
      ? "chat"
      : /image|png|jpg|jpeg|webp/.test(capabilityText)
        ? "image"
        : "video";
  const title = safeText(
    input.notes,
    kind === "app" ? `RunningHub AI 应用 ${pageId || runTargetId}` : `RunningHub Workflow ${pageId || runTargetId}`
  ).slice(0, 80);
  const baseDraft = { title, note: safeText(input.notes, "待管理员确认条目标题、备注与运行目标。"), pageId, runTargetId, taskCapability };
  const inputDraft = {
    fields: requestExampleFields,
    guidance: requestExampleFields.length > 0
      ? "已从 requestExample.nodeInfoList 生成输入槽草案，请重点核对 nodeId、fieldName 与 required。"
      : "从文档或示例请求中补齐输入槽定义，至少包含 nodeId、fieldName、valueType、required。"
  };
  const parameterDraft = requestExampleFields.length > 0
    ? buildParameterDraftFromFields(requestExampleFields)
    : { type: "object", properties: {}, required: [] };
  const fallbackOutputDraft = { outputs: [buildFallbackOutputDefinition(taskCapability)] };
  const fallbackExecutionDraft = normalizeRunningHubExecutionRules(undefined, kind, runTargetId);
  const outputDraft = buildOutputDraftFromResponseExample(responseExampleObject, taskCapability, fallbackOutputDraft);
  const executionDraft = buildExecutionDraft(kind, runTargetId, responseExampleObject, outputDraft, fallbackExecutionDraft);
  const warnings = [
    "AI 草案不会直接覆盖现有条目，应用前仍需人工确认。",
    "pageId / runTargetId 仅作为后台目录字段保存，不会下放给终端用户手工维护。"
  ];
  const requestedRunTargetId = safeText(input.runTargetId);
  if (requestedRunTargetId && referenceTargetId && requestedRunTargetId !== referenceTargetId) {
    warnings.push("文档链接里的 runTargetId 与表单填写值不一致，请人工确认最终提交目标。");
  }
  if (requestedRunTargetId && requestExampleRunTargetId && requestedRunTargetId !== requestExampleRunTargetId) {
    warnings.push("requestExample 里的 runTargetId 与表单填写的运行目标 ID 不一致，请人工确认最终提交目标。");
  }
  if (safeText(input.requestExample) && !requestExampleObject) {
    warnings.push("requestExample 不是合法 JSON 对象，本轮无法自动解析 nodeInfoList。");
  }
  if (safeText(input.responseExample) && !responseExampleObject) {
    warnings.push("responseExample 不是合法 JSON 对象，本轮只把它作为能力线索参与分析。");
  }
  if (requestExampleObject && requestExampleFields.length <= 0) {
    warnings.push("requestExample 已解析，但没有识别到可用的 nodeInfoList 字段。");
  }
  const autoSwitchMessage = detectedTarget.shouldSwitch
    ? kind === "app"
      ? "检测到这是 AI App，已自动切换到 AI 应用区域"
      : "检测到这是工作流，已自动切换到工作流区域"
    : "";
  return {
    summary: `已根据 ${kind === "app" ? "AI 应用" : "工作流"} 线索生成结构化 RH 草案，请重点核对运行目标、输入槽和执行规则。`,
    ...(detectedTarget.kind ? { detectedKind: detectedTarget.kind } : {}),
    detectedTargetId: runTargetId || detectedTarget.targetId,
    autoSwitchMessage,
    sections: [
      { key: "base", title: "基础信息草案", description: "条目标题、备注和运行目标。", payload: baseDraft },
      { key: "inputs", title: "输入槽草案", description: "建议补齐输入槽结构，而不是直接手写 JSON。", payload: inputDraft },
      { key: "params", title: "参数 Schema 草案", description: "面向节点参数渲染的结构化参数草案。", payload: parameterDraft },
      { key: "outputs", title: "输出定义草案", description: "后端结果提取后的输出定义。", payload: outputDraft },
      { key: "execution", title: "执行规则草案", description: "提交、结果提取和错误提取规则。", payload: executionDraft }
    ],
    warnings
  };
}

interface RhDetectedTarget {
  kind: "app" | "workflow" | undefined;
  targetId: string;
  confidence: "high" | "low";
  reason: string;
  shouldSwitch: boolean;
}

function detectRhTarget(input: {
  docUrl?: string;
  sourceUrl?: string;
  runTargetId?: string;
  pageId?: string;
  requestExample?: Record<string, unknown> | null;
  requestedKind?: "app" | "workflow";
}): RhDetectedTarget {
  const docUrl = safeText(input.docUrl || input.sourceUrl);
  const requestExample = input.requestExample || null;
  const requestedKind = input.requestedKind === "app" ? "app" : "workflow";
  const referenceRef = parseRunningHubRef(docUrl);
  if (referenceRef?.id) {
    return {
      kind: referenceRef.type,
      targetId: referenceRef.id,
      confidence: "high",
      reason: referenceRef.type === "app" ? "文档链接命中 AI App 路径" : "文档链接命中 Workflow 路径",
      shouldSwitch: referenceRef.type !== requestedKind
    };
  }
  const workflowId = safeText(requestExample?.workflowId || input.runTargetId);
  if (/^workflow-[0-9A-Za-z_-]+$/i.test(workflowId)) {
    return { kind: "workflow", targetId: workflowId, confidence: "high", reason: "命中 workflow 风格 ID", shouldSwitch: requestedKind !== "workflow" };
  }
  const appId = safeText(requestExample?.webappId || requestExample?.runTargetId || input.runTargetId);
  if (appId && /\/(?:openapi\/v2\/)?run\/ai-app\//i.test(docUrl)) {
    return { kind: "app", targetId: appId, confidence: "high", reason: "文档与示例共同指向 AI App", shouldSwitch: requestedKind !== "app" };
  }
  return {
    kind: undefined,
    targetId: safeText(input.runTargetId || workflowId || appId || input.pageId),
    confidence: "low",
    reason: "仅识别到 targetId，类型待确认",
    shouldSwitch: false
  };
}

function tryParseRhExampleObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractFirstBalancedObjectSnippet(text: string) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char !== "}" || depth <= 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    const candidate = text.slice(start, index + 1).trim();
    if (tryParseRhExampleObject(candidate)) return candidate;
    start = -1;
  }
  return "";
}

function extractJsonObjectSnippet(text: string) {
  const fencedPattern = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fencedPattern)) {
    const fencedText = safeLongText(match[1], "", 16000);
    if (!fencedText) continue;
    if (tryParseRhExampleObject(fencedText)) return fencedText;
    const nestedSnippet = extractFirstBalancedObjectSnippet(fencedText);
    if (nestedSnippet) return nestedSnippet;
  }
  return extractFirstBalancedObjectSnippet(text);
}

function parseRhExampleObject(value: unknown): Record<string, unknown> | null {
  const text = safeLongText(value, "", 16000);
  if (!text) return null;
  const directObject = tryParseRhExampleObject(text);
  if (directObject) return directObject;
  const snippet = extractJsonObjectSnippet(text);
  if (!snippet) return null;
  return tryParseRhExampleObject(snippet);
}

function extractRunTargetIdFromExample(kind: "app" | "workflow", example: Record<string, unknown> | null) {
  if (!example) return "";
  return safeText(
    example.runTargetId
    || (kind === "app" ? example.webappId : example.workflowId)
    || example.webappId
    || example.workflowId
  );
}

function extractPageIdFromExample(example: Record<string, unknown> | null) {
  if (!example) return "";
  return safeText(example.pageId);
}

function inferFieldValueTypeFromExample(fieldName: string, fieldValue: unknown) {
  const normalizedName = safeText(fieldName).toLowerCase();
  if (typeof fieldValue === "boolean") return "boolean";
  if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) return "number";
  if (Array.isArray(fieldValue)) return "array";
  if (fieldValue && typeof fieldValue === "object") return "json";
  if (/image|img|picture/.test(normalizedName)) return "image";
  if (/video/.test(normalizedName)) return "video";
  if (/audio|voice|sound/.test(normalizedName)) return "audio";
  return "string";
}

function normalizeFieldExampleValue(fieldValue: unknown) {
  if (typeof fieldValue === "boolean") return fieldValue;
  if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) return fieldValue;
  if (Array.isArray(fieldValue) || (fieldValue && typeof fieldValue === "object")) {
    try {
      return JSON.stringify(fieldValue);
    } catch {
      return safeText(fieldValue);
    }
  }
  return safeText(fieldValue);
}

function buildFieldLabel(fieldName: string) {
  return safeText(fieldName)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim() || "未命名输入槽";
}

function buildFieldsFromRequestExample(example: Record<string, unknown> | null): RhFieldDefinition[] {
  const rawList = Array.isArray(example?.nodeInfoList) ? example.nodeInfoList : [];
  const fields = new Map<string, RhFieldDefinition>();
  for (const item of rawList) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const nodeId = safeText(row.nodeId);
    const fieldName = safeText(row.fieldName);
    if (!nodeId || !fieldName) continue;
    const fieldValue = row.fieldValue;
    const key = `${nodeId}:${fieldName}`;
    if (fields.has(key)) continue;
    const valueType = inferFieldValueTypeFromExample(fieldName, fieldValue);
    const normalizedValue = normalizeFieldExampleValue(fieldValue);
    fields.set(key, {
      nodeId,
      fieldName,
      label: buildFieldLabel(fieldName),
      description: `来自 requestExample.nodeInfoList 的 ${nodeId}.${fieldName}`,
      fieldType: valueType,
      valueType,
      required: normalizedValue !== "",
      ...(normalizedValue === "" ? {} : { fieldValue: normalizedValue, defaultValue: normalizedValue })
    });
  }
  return Array.from(fields.values());
}

function inferOutputKindFromUrl(url: string): string {
  if (/\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i.test(url)) return "image";
  if (/\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(url)) return "audio";
  return "";
}

function collectExampleUrls(value: unknown, seen = new Set<string>()): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^https?:\/\//i.test(text)) return [];
    if (seen.has(text)) return [];
    seen.add(text);
    return [text];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectExampleUrls(item, seen));
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return [
      ...collectExampleUrls(row.url, seen),
      ...collectExampleUrls(row.fileUrl, seen),
      ...collectExampleUrls(row.downloadUrl, seen),
      ...collectExampleUrls(row.previewUrl, seen),
      ...collectExampleUrls(row.src, seen),
      ...collectExampleUrls(row.outputs, seen),
      ...collectExampleUrls(row.results, seen),
      ...collectExampleUrls(row.files, seen),
      ...collectExampleUrls(row.data, seen),
      ...collectExampleUrls(row.result, seen)
    ];
  }
  return [];
}

function pickResponseContainer(example: Record<string, unknown> | null) {
  const candidates: Array<{ path: string; value: unknown }> = example
    ? [
        { path: "data.outputs", value: (example.data as Record<string, unknown> | undefined)?.outputs },
        { path: "data.results", value: (example.data as Record<string, unknown> | undefined)?.results },
        { path: "data.files", value: (example.data as Record<string, unknown> | undefined)?.files },
        { path: "data.result", value: (example.data as Record<string, unknown> | undefined)?.result },
        { path: "data", value: example.data },
        { path: "result", value: example.result },
        { path: "outputs", value: example.outputs },
        { path: "results", value: example.results },
        { path: "files", value: example.files }
      ]
    : [];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    if (collectExampleUrls(candidate.value).length > 0) return candidate;
    if (typeof candidate.value === "string" && candidate.value.trim()) return candidate;
    if (Array.isArray(candidate.value) && candidate.value.length > 0) return candidate;
    if (candidate.value && typeof candidate.value === "object" && Object.keys(candidate.value).length > 0) return candidate;
  }
  return { path: "data", value: example?.data ?? example ?? null };
}

function pickTextOutputPath(value: unknown, basePath: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return basePath || "data";
  const row = value as Record<string, unknown>;
  for (const key of ["text", "content", "message", "msg", "caption", "prompt"]) {
    if (typeof row[key] === "string" && safeText(row[key])) return basePath ? `${basePath}.${key}` : key;
  }
  return basePath || "data";
}

function buildFallbackOutputDefinition(taskCapability: RhTaskCapability): RhOutputDefinition {
  const kind = taskCapability === "chat" ? "text" : taskCapability;
  return {
    key: kind,
    label: kind === "audio" ? "输出音频" : kind === "image" ? "输出图像" : kind === "text" ? "输出文本" : "输出视频",
    kind,
    path: "data",
    multiple: kind !== "text"
  };
}

function buildOutputDraftFromResponseExample(
  example: Record<string, unknown> | null,
  taskCapability: RhTaskCapability,
  fallback?: { outputs?: RhOutputDefinition[] },
): { outputs: RhOutputDefinition[] } {
  const fallbackOutput = normalizeOutputDefinitions(fallback?.outputs)[0] || buildFallbackOutputDefinition(taskCapability);
  if (!example) return { outputs: [fallbackOutput] };
  const container = pickResponseContainer(example);
  const containerPath = safeText(container.path, fallbackOutput.path || "data");
  const urls = collectExampleUrls(container.value);
  const grouped = new Map<string, string[]>();
  for (const url of urls) {
    const kind = inferOutputKindFromUrl(url);
    if (!kind) continue;
    grouped.set(kind, [...(grouped.get(kind) || []), url]);
  }
  const outputs: RhOutputDefinition[] = [];
  for (const kind of ["image", "video", "audio"]) {
    const list = grouped.get(kind);
    if (!list?.length) continue;
    outputs.push({
      key: kind,
      label: kind === "image" ? "输出图像" : kind === "video" ? "输出视频" : "输出音频",
      kind,
      path: containerPath,
      multiple: list.length !== 1
    });
  }
  if (outputs.length > 0) return { outputs };
  const textPath = pickTextOutputPath(container.value, containerPath);
  if (taskCapability === "chat" || typeof container.value === "string" || Array.isArray(container.value)) {
    return { outputs: [{ key: "text", label: "输出文本", kind: "text", path: textPath, multiple: Array.isArray(container.value) }] };
  }
  return { outputs: [{ ...fallbackOutput, path: containerPath || fallbackOutput.path || "data" }] };
}

function hasAsyncTaskSignal(example: Record<string, unknown> | null) {
  if (!example) return false;
  const data = example.data && typeof example.data === "object" && !Array.isArray(example.data)
    ? example.data as Record<string, unknown>
    : {};
  return Boolean(
    safeText(example.taskId)
    || safeText(example.task_id)
    || safeText(data.taskId)
    || safeText(data.task_id)
    || safeText(example.status)
    || safeText(data.status)
  );
}

function inferErrorPath(example: Record<string, unknown> | null) {
  if (!example) return "message";
  const candidates = ["message", "msg", "errorMessage", "error", "detail"];
  for (const key of candidates) {
    if (safeText(example[key])) return key;
  }
  const data = example.data && typeof example.data === "object" && !Array.isArray(example.data)
    ? example.data as Record<string, unknown>
    : {};
  for (const key of candidates) {
    if (safeText(data[key])) return `data.${key}`;
  }
  return "message";
}

function buildExecutionDraft(
  kind: RhCatalogItemKind,
  runTargetId: string,
  responseExampleObject: Record<string, unknown> | null,
  outputDraft: { outputs?: RhOutputDefinition[] },
  fallback?: RhExecutionRules,
): RhExecutionRules {
  const fallbackRules = fallback || normalizeRunningHubExecutionRules(undefined, kind, runTargetId);
  const outputs = normalizeOutputDefinitions(outputDraft.outputs);
  const primaryOutput = outputs[0];
  const asyncTask = hasAsyncTaskSignal(responseExampleObject) && collectExampleUrls(responseExampleObject).length === 0;
  return {
    ...fallbackRules,
    endpoint: runningHubDefaultEndpoint(kind, runTargetId),
    resultPath: safeText(primaryOutput?.path, fallbackRules.resultPath || "data"),
    errorPath: inferErrorPath(responseExampleObject),
    supportsMultipleOutputs: outputs.some((item) => item.multiple !== false) || fallbackRules.supportsMultipleOutputs,
    pollingStrategy: asyncTask ? "fixed-interval" : "none",
    pollingIntervalMs: asyncTask ? 5000 : 0
  };
}

function mapValueTypeToSchemaType(valueType: string) {
  const normalized = safeText(valueType).toLowerCase();
  if (normalized === "boolean") return "boolean";
  if (normalized === "number") return "number";
  if (normalized === "array") return "array";
  if (normalized === "json") return "object";
  return "string";
}

function buildParameterDraftFromFields(fields: RhFieldDefinition[]) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  const keyCount = new Map<string, number>();
  for (const field of fields) {
    const baseKey = safeText(field.fieldName, "field");
    const nextCount = (keyCount.get(baseKey) || 0) + 1;
    keyCount.set(baseKey, nextCount);
    const schemaKey = nextCount > 1 ? `${baseKey}_${safeText(field.nodeId, "node")}` : baseKey;
    properties[schemaKey] = {
      type: mapValueTypeToSchemaType(field.valueType || field.fieldType || "string"),
      title: safeText(field.label, field.fieldName),
      description: safeText(field.description, `映射到 ${field.nodeId}.${field.fieldName}`)
    };
    if (field.defaultValue !== undefined && field.defaultValue !== "") properties[schemaKey].default = field.defaultValue;
    if (Array.isArray(field.options) && field.options.length > 0) properties[schemaKey].enum = field.options;
    if (field.required) required.push(schemaKey);
  }
  return { type: "object", properties, required };
}
