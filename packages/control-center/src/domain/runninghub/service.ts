import { randomUUID } from "node:crypto";
import type { ProviderRepository } from "../../repository/providers.js";
import type { ProviderRecord, RhCatalogEntry, RhCatalogGroup } from "../types.js";
import {
  assertRunningHubEntryCanBeEnabled,
  assertRunningHubTargetConsistency,
  createBlankRhCatalogEntry,
  createRhCatalogEntryId,
  isRunningHubDefaultEndpoint,
  normalizeOutputDefinitions,
  normalizeRunningHubCatalogItem,
  normalizeRunningHubCatalogItems,
  normalizeRunningHubExecutionRules,
  normalizeRunningHubFieldDefinitions,
  normalizeRunningHubGroups,
  preserveRunningHubJsonText,
  preserveRunningHubObjectJsonText,
  safeRunningHubJsonText,
  safeRunningHubObjectJsonText,
  runningHubDefaultEndpoint,
  runningHubCatalogId,
  toAdminRunningHubCatalogItem,
  type RhAdminCatalogItem,
  type RhExecutionRules,
  type RhOutputDefinition
} from "./catalog.js";
import { normalizeRunningHubInputSlots } from "aigc-provider-runtime-kit/runninghub";
import { safeText, safeSlug } from "../../util.js";

export type { RhAdminCatalogItem };

export interface RhCatalogMutationBody {
  providerId?: string;
  kind?: "app" | "workflow";
  title?: string;
  note?: string;
  sourceCatalogId?: string;
  groupId?: string;
  enabled?: boolean;
  thumbnail?: string;
  workflowJson?: string;
  fields?: unknown;
  pageId?: string;
  appId?: string;
  workflowId?: string;
  runTargetId?: string;
  taskCapability?: "image" | "video" | "audio" | "chat";
  parameterSchema?: unknown;
  outputSchema?: unknown;
  executionRules?: unknown;
  testPayload?: unknown;
}

export interface RhGroupMutationBody {
  providerId?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export type RhCatalogService = ReturnType<typeof createRunningHubCatalogService>;

export function createRunningHubCatalogService(repository: ProviderRepository, randomToken = (bytes: number) => randomUUID().slice(0, bytes * 2).slice(0, bytes * 2)) {
  function assertProviderIsRunningHub(provider: ProviderRecord) {
    if (String(provider.protocol) !== "runninghub") throw new Error("Provider 协议必须是 runninghub");
  }

  async function listProviderCatalogItems(provider: ProviderRecord): Promise<RhAdminCatalogItem[]> {
    const workflows = normalizeRunningHubCatalogItems(provider.rhWorkflows, "workflow").map((entry) => toAdminRunningHubCatalogItem(provider, entry));
    const apps = normalizeRunningHubCatalogItems(provider.rhApps, "app").map((entry) => toAdminRunningHubCatalogItem(provider, entry));
    return [...workflows, ...apps];
  }

  async function listCatalogItems(): Promise<RhAdminCatalogItem[]> {
    const providers = await repository.readProviderRecords();
    const items: RhAdminCatalogItem[] = [];
    for (const provider of providers) {
      if (safeText(provider.protocol) !== "runninghub") continue;
      items.push(...await listProviderCatalogItems(provider));
    }
    return items;
  }

  async function findCatalogItemDetail(catalogId: string): Promise<RhAdminCatalogItem | null> {
    const items = await listCatalogItems();
    const canonicalMatch = items.find((entry) => entry.catalogId === catalogId);
    if (canonicalMatch) return canonicalMatch;
    const idMatches = items.filter((entry) => entry.id === catalogId);
    return idMatches.length === 1 && idMatches[0] ? idMatches[0] : null;
  }

  function parseCatalogId(catalogId: string): { providerId: string; kind: "app" | "workflow"; itemId: string } {
    const [providerId, kindText, itemId] = String(catalogId || "").split(":");
    const kind = kindText === "app" ? "app" : "workflow";
    if (!providerId || !itemId) throw new Error("RunningHub catalogId 无效");
    return { providerId, kind, itemId };
  }

  async function createCatalogItem(input: RhCatalogMutationBody): Promise<Pick<RhAdminCatalogItem, "catalogId" | "title">> {
    const providerId = safeText(input.providerId);
    if (!providerId) throw new Error("缺少 RunningHub Provider");
    const kind = input.kind === "app" ? "app" : "workflow";
    const provider = await repository.findProviderRecordById(providerId);
    if (!provider) throw new Error("Provider 不存在");
    const source = input.sourceCatalogId ? await findCatalogItemDetail(safeText(input.sourceCatalogId)) : null;
    const nextTitle = safeText(
      input.title,
      source ? `${source.title} 副本` : kind === "app" ? "新建 AI 应用" : "新建工作流"
    );
    const nextEntry: RhCatalogEntry = source
      ? {
          ...(normalizeRunningHubCatalogItem(source, kind) as RhCatalogEntry),
          id: createRhCatalogEntryId(kind, randomToken),
          kind,
          title: nextTitle,
          note: safeText(input.note, source.note || ""),
          enabled: true
        }
      : createBlankRhCatalogEntry(kind, nextTitle, randomToken);
    nextEntry.enabled = input.enabled === undefined ? nextEntry.enabled : Boolean(input.enabled);
    const groups = normalizeRunningHubGroups(provider.rhGroups, providerId);
    if (input.groupId !== undefined) {
      const groupId = safeText(input.groupId);
      if (groupId && !groups.some((group) => group.id === groupId)) throw new Error("RUNNINGHUB_GROUP_NOT_FOUND");
      if (groupId) nextEntry.groupId = groupId;
      else delete nextEntry.groupId;
    }
    if (input.note !== undefined) nextEntry.note = safeText(input.note);
    if (input.thumbnail !== undefined) nextEntry.thumbnail = safeText(input.thumbnail);
    if (input.workflowJson !== undefined) nextEntry.workflowJson = safeRunningHubJsonText(input.workflowJson, "");
    const inputTestPayload = input.testPayload === undefined ? nextEntry.testPayload : input.testPayload;
    nextEntry.fields = input.fields === undefined
      ? normalizeRunningHubFieldDefinitions(nextEntry.fields)
      : normalizeRunningHubFieldDefinitions(input.fields);
    nextEntry.pageId = input.pageId === undefined ? safeText(nextEntry.pageId, nextEntry.id) : safeText(input.pageId, nextEntry.id);
    nextEntry.runTargetId = input.runTargetId === undefined ? safeText(nextEntry.runTargetId, nextEntry.id) : safeText(input.runTargetId, nextEntry.id);
    nextEntry.taskCapability = normalizeTaskCapability(input.taskCapability) || (nextEntry.taskCapability as RhTaskValue) || (kind === "app" ? "image" : "video");
    nextEntry.pageId = safeText(nextEntry.pageId, nextEntry.id);
    nextEntry.runTargetId = safeText(nextEntry.runTargetId, nextEntry.id);
    if (kind === "app") {
      nextEntry.appId = input.appId === undefined ? safeText(nextEntry.appId, nextEntry.runTargetId) : safeText(input.appId, nextEntry.runTargetId);
      nextEntry.workflowId = "";
    } else {
      nextEntry.workflowId = input.workflowId === undefined ? safeText(nextEntry.workflowId, nextEntry.runTargetId) : safeText(input.workflowId, nextEntry.runTargetId);
      nextEntry.appId = "";
    }
    nextEntry.parameterSchema = input.parameterSchema === undefined
      ? safeRunningHubObjectJsonText(nextEntry.parameterSchema, "{}")
      : safeRunningHubObjectJsonText(input.parameterSchema, "{}");
    nextEntry.allowsEmptyInputs = hasExplicitEmptyNodeInfoList(inputTestPayload);
    nextEntry.outputSchema = input.outputSchema === undefined
      ? normalizeOutputDefinitions(nextEntry.outputSchema)
      : normalizeOutputDefinitions(input.outputSchema);
    nextEntry.executionRules = input.executionRules === undefined
      ? normalizeRunningHubExecutionRules(nextEntry.executionRules, kind, nextEntry.runTargetId)
      : normalizeRunningHubExecutionRules(input.executionRules, kind, nextEntry.runTargetId);
    nextEntry.testPayload = input.testPayload === undefined ? safeRunningHubJsonText(nextEntry.testPayload, "{}") : safeRunningHubJsonText(input.testPayload, "{}");
    assertRunningHubTargetConsistency(kind, nextEntry);
    assertRunningHubEntryCanBeEnabled({ ...nextEntry, catalogId: runningHubCatalogId(providerId, kind, nextEntry.id) });
    const updatedProvider = await repository.updateProviderRhCatalog(providerId, (current) => {
      const list = normalizeRunningHubCatalogItems(kind === "app" ? current.rhApps : current.rhWorkflows, kind);
      const merged = [...list, nextEntry];
      return {
        ...current,
        rhApps: kind === "app" ? merged : normalizeRunningHubCatalogItems(current.rhApps, "app"),
        rhWorkflows: kind === "workflow" ? merged : normalizeRunningHubCatalogItems(current.rhWorkflows, "workflow"),
        updatedAt: Date.now()
      };
    });
    return { catalogId: runningHubCatalogId(providerId, kind, nextEntry.id), title: toAdminRunningHubCatalogItem(updatedProvider, nextEntry).title };
  }

  async function deleteCatalogItem(catalogId: string): Promise<Pick<RhAdminCatalogItem, "catalogId" | "title">> {
    const detail = await findCatalogItemDetail(catalogId);
    if (!detail) throw new Error("RunningHub 条目不存在");
    const { providerId, kind, itemId } = parseCatalogId(catalogId);
    await repository.updateProviderRhCatalog(providerId, (current) => {
      const sourceList = normalizeRunningHubCatalogItems(kind === "app" ? current.rhApps : current.rhWorkflows, kind);
      const nextList = sourceList.filter((entry) => entry.id !== itemId);
      return {
        ...current,
        rhApps: kind === "app" ? nextList : normalizeRunningHubCatalogItems(current.rhApps, "app"),
        rhWorkflows: kind === "workflow" ? nextList : normalizeRunningHubCatalogItems(current.rhWorkflows, "workflow"),
        updatedAt: Date.now()
      };
    });
    return { catalogId, title: detail.title };
  }

  async function updateCatalogItem(catalogId: string, patch: RhCatalogMutationBody): Promise<Pick<RhAdminCatalogItem, "catalogId" | "title">> {
    const { providerId, kind, itemId } = parseCatalogId(catalogId);
    const provider = await repository.findProviderRecordById(providerId);
    if (!provider) throw new Error("RunningHub Provider 不存在");
    const sourceAppList = normalizeRunningHubCatalogItems(provider.rhApps, "app");
    const sourceWorkflowList = normalizeRunningHubCatalogItems(provider.rhWorkflows, "workflow");
    const sourceList = kind === "app" ? sourceAppList : sourceWorkflowList;
    const sourceEntry = sourceList.find((entry) => entry.id === itemId);
    if (!sourceEntry) throw new Error("RunningHub 条目不存在");
    const nextKind = patch.kind === "app" ? "app" : patch.kind === "workflow" ? "workflow" : kind;
    const previousTargetId = sourceEntry.runTargetId || sourceEntry.id;
    const targetId = safeText(patch.runTargetId, sourceEntry.runTargetId || sourceEntry.id);
    const pageId = safeText(patch.pageId, sourceEntry.pageId || sourceEntry.id);
    const appId = nextKind === "app" ? safeText(patch.appId, sourceEntry.appId || targetId || sourceEntry.id) : "";
    const workflowId = nextKind === "workflow" ? safeText(patch.workflowId, sourceEntry.workflowId || targetId || sourceEntry.id) : "";
    const taskCapability = normalizeTaskCapability(patch.taskCapability)
      || normalizeTaskCapability(sourceEntry.taskCapability)
      || "video";
    const baseExecutionRules = patch.executionRules === undefined
      ? normalizeRunningHubExecutionRules(sourceEntry.executionRules, nextKind, previousTargetId)
      : normalizeRunningHubExecutionRules(patch.executionRules, nextKind, previousTargetId);
    const shouldReplaceDefaultEndpoint = isRunningHubDefaultEndpoint(kind, previousTargetId, baseExecutionRules.endpoint)
      || isRunningHubDefaultEndpoint(nextKind, previousTargetId, baseExecutionRules.endpoint);
    const nextExecutionEndpoint = shouldReplaceDefaultEndpoint ? runningHubDefaultEndpoint(nextKind, targetId) : baseExecutionRules.endpoint;
    const entryTestPayload = patch.testPayload === undefined ? sourceEntry.testPayload : patch.testPayload;
    const next: RhCatalogEntry = {
      ...sourceEntry,
      kind: nextKind,
      title: patch.title === undefined ? sourceEntry.title : safeText(patch.title, sourceEntry.title),
      ...(patch.note === undefined
        ? (sourceEntry.note ? { note: sourceEntry.note } : {})
        : { note: safeText(patch.note) }),
      enabled: patch.enabled === undefined ? sourceEntry.enabled : Boolean(patch.enabled),
      ...(patch.thumbnail === undefined
        ? (sourceEntry.thumbnail ? { thumbnail: sourceEntry.thumbnail } : {})
        : { thumbnail: safeText(patch.thumbnail) }),
      pageId,
      appId,
      workflowId,
      workflowJson: patch.workflowJson === undefined ? preserveRunningHubJsonText(sourceEntry.workflowJson, "") : safeRunningHubJsonText(patch.workflowJson, ""),
      fields: patch.fields === undefined ? normalizeRunningHubFieldDefinitions(sourceEntry.fields) : normalizeRunningHubFieldDefinitions(patch.fields),
      allowsEmptyInputs: hasExplicitEmptyNodeInfoList(entryTestPayload),
      runTargetId: targetId,
      taskCapability,
      parameterSchema: patch.parameterSchema === undefined
        ? preserveRunningHubObjectJsonText(sourceEntry.parameterSchema, "{}")
        : safeRunningHubObjectJsonText(patch.parameterSchema, "{}"),
      outputSchema: patch.outputSchema === undefined
        ? normalizeOutputDefinitions(sourceEntry.outputSchema)
        : normalizeOutputDefinitions(patch.outputSchema),
      executionRules: {
        ...baseExecutionRules,
        endpoint: nextExecutionEndpoint,
        targetType: nextKind
      },
      testPayload: patch.testPayload === undefined ? preserveRunningHubJsonText(sourceEntry.testPayload, "{}") : safeRunningHubJsonText(patch.testPayload, "{}")
    };
    if (patch.groupId !== undefined) {
      const groupId = safeText(patch.groupId);
      const groups = normalizeRunningHubGroups(provider.rhGroups, providerId);
      if (groupId && !groups.some((group) => group.id === groupId)) throw new Error("RUNNINGHUB_GROUP_NOT_FOUND");
      if (groupId) next.groupId = groupId;
      else delete next.groupId;
    }
    assertRunningHubTargetConsistency(nextKind, next);
    assertRunningHubEntryCanBeEnabled({ ...next, catalogId: catalogId });
    await repository.updateProviderRhCatalog(providerId, (current) => {
      const currentAppList = normalizeRunningHubCatalogItems(current.rhApps, "app");
      const currentWorkflowList = normalizeRunningHubCatalogItems(current.rhWorkflows, "workflow");
      return {
        ...current,
        rhApps: nextKind === "app"
          ? [...currentAppList.filter((entry) => entry.id !== itemId), next]
          : currentAppList.filter((entry) => entry.id !== itemId),
        rhWorkflows: nextKind === "workflow"
          ? [...currentWorkflowList.filter((entry) => entry.id !== itemId), next]
          : currentWorkflowList.filter((entry) => entry.id !== itemId),
        updatedAt: Date.now()
      };
    });
    return { catalogId: runningHubCatalogId(providerId, nextKind, itemId), title: next.title || itemId };
  }

  // -- groups -------------------------------------------------------------

  async function listGroups(providerId: string): Promise<RhCatalogGroup[]> {
    const normalizedProviderId = safeText(providerId);
    if (!normalizedProviderId) throw new Error("缺少 RunningHub Provider");
    const provider = await repository.findProviderRecordById(normalizedProviderId);
    if (!provider) throw new Error("Provider 不存在");
    return normalizeRunningHubGroups(provider.rhGroups, provider.id);
  }

  async function findGroupOwner(groupId: string, providerId?: string) {
    const providers = providerId ? [await repository.findProviderRecordById(providerId)].filter(Boolean) : await repository.readProviderRecords();
    for (const provider of providers as ProviderRecord[]) {
      const groups = normalizeRunningHubGroups(provider.rhGroups, provider.id);
      const group = groups.find((item) => item.id === groupId);
      if (group) return { provider, group };
    }
    return null;
  }

  async function createGroup(input: RhGroupMutationBody): Promise<RhCatalogGroup> {
    const providerId = safeText(input.providerId);
    if (!providerId) throw new Error("缺少 RunningHub Provider");
    const provider = await repository.findProviderRecordById(providerId);
    if (!provider) throw new Error("Provider 不存在");
    const name = safeText(input.name, "").slice(0, 120);
    if (!name) throw new Error("RUNNINGHUB_GROUP_NAME_REQUIRED");
    const groups = normalizeRunningHubGroups(provider.rhGroups, providerId);
    if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) throw new Error("RUNNINGHUB_GROUP_NAME_EXISTS");
    const now = Date.now();
    const group: RhCatalogGroup = {
      id: `rhg-${now}-${randomToken(4)}`,
      providerId,
      name,
      description: safeText(input.description, "").slice(0, 1000),
      enabled: input.enabled !== false,
      sortOrder: Math.max(0, Math.floor(Number(input.sortOrder) || 0)),
      createdAt: now,
      updatedAt: now
    };
    await repository.updateProviderRhCatalog(providerId, (current) => ({
      ...current,
      rhGroups: [...normalizeRunningHubGroups(current.rhGroups, current.id), group],
      updatedAt: now
    }));
    return group;
  }

  async function updateGroup(groupId: string, input: RhGroupMutationBody): Promise<RhCatalogGroup> {
    const found = await findGroupOwner(groupId, safeText(input.providerId) || undefined);
    if (!found) throw new Error("RUNNINGHUB_GROUP_NOT_FOUND");
    const groups = normalizeRunningHubGroups(found.provider.rhGroups, found.provider.id);
    const name = input.name === undefined ? found.group.name : safeText(input.name, "").slice(0, 120);
    if (!name) throw new Error("RUNNINGHUB_GROUP_NAME_REQUIRED");
    if (groups.some((group) => group.id !== groupId && group.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("RUNNINGHUB_GROUP_NAME_EXISTS");
    }
    const updated: RhCatalogGroup = {
      ...found.group,
      name,
      description: input.description === undefined ? found.group.description : safeText(input.description, "").slice(0, 1000),
      enabled: input.enabled === undefined ? found.group.enabled : Boolean(input.enabled),
      sortOrder: input.sortOrder === undefined ? found.group.sortOrder : Math.max(0, Math.floor(Number(input.sortOrder) || 0)),
      updatedAt: Date.now()
    };
    await repository.updateProviderRhCatalog(found.provider.id, (current) => ({
      ...current,
      rhGroups: normalizeRunningHubGroups(current.rhGroups, current.id).map((group) => group.id === groupId ? updated : group),
      updatedAt: updated.updatedAt
    }));
    return updated;
  }

  async function deleteGroup(groupId: string): Promise<{ groupId: string; ungroupedCatalogIds: string[] }> {
    const found = await findGroupOwner(groupId);
    if (!found) throw new Error("RUNNINGHUB_GROUP_NOT_FOUND");
    const ungroupedCatalogIds: string[] = [];
    await repository.updateProviderRhCatalog(found.provider.id, (current) => {
      const groups = normalizeRunningHubGroups(current.rhGroups, current.id).filter((group) => group.id !== groupId);
      const ungroup = (entries: unknown, kind: "app" | "workflow") => normalizeRunningHubCatalogItems(entries, kind).map((entry) => {
        if (entry.groupId !== groupId) return entry;
        ungroupedCatalogIds.push(runningHubCatalogId(current.id, kind, entry.id));
        const ungroupedEntry: RhCatalogEntry = { ...entry };
        delete ungroupedEntry.groupId;
        return ungroupedEntry;
      });
      return {
        ...current,
        rhGroups: groups,
        rhApps: ungroup(current.rhApps, "app"),
        rhWorkflows: ungroup(current.rhWorkflows, "workflow"),
        updatedAt: Date.now()
      };
    });
    return { groupId, ungroupedCatalogIds };
  }

  // -- test ---------------------------------------------------------------

  async function testCatalogItem(catalogId: string, testPayloadValue: unknown) {
    const item = await findCatalogItemDetail(catalogId);
    if (!item) throw new Error("RunningHub 条目不存在");
    const testPayloadText = preserveJsonText(testPayloadValue ?? item.testPayload ?? "{}");
    const testPayload = JSON.parse(testPayloadText) as Record<string, unknown>;
    const requiredSlots = (item.inputSlots ?? []).filter((slot) => slot.required);
    const slotNameCount = new Map<string, number>();
    const slotTitleCount = new Map<string, number>();
    for (const slot of item.inputSlots ?? []) {
      if (slot.name) slotNameCount.set(slot.name, (slotNameCount.get(slot.name) || 0) + 1);
      if (slot.title) slotTitleCount.set(slot.title, (slotTitleCount.get(slot.title) || 0) + 1);
    }
    const missing = requiredSlots
      .filter((slot) => {
        const byKey = testPayload[slot.key];
        const byPath = testPayload[slot.bindingTarget.path];
        if (byKey !== undefined || byPath !== undefined) return false;
        const uniqueName = slot.name && slotNameCount.get(slot.name) === 1 ? testPayload[slot.name] : undefined;
        const uniqueTitle = slot.title && slotTitleCount.get(slot.title) === 1 ? testPayload[slot.title] : undefined;
        return uniqueName === undefined && uniqueTitle === undefined;
      })
      .map((slot) => {
        const ambiguousName = slot.name ? (slotNameCount.get(slot.name) || 0) > 1 : false;
        const ambiguousTitle = slot.title ? (slotTitleCount.get(slot.title) || 0) > 1 : false;
        if (ambiguousName || ambiguousTitle) {
          return `${slot.title || slot.name}（请使用 ${slot.key} 或 ${slot.bindingTarget.path}）`;
        }
        return slot.title || slot.name;
      });
    const endpoint = item.executionRules?.endpoint || item.execution.submit.endpoint;
    return {
      ok: missing.length === 0,
      message: missing.length ? `缺少必填输入槽: ${missing.join("、")}` : `已生成 ${endpoint} 的预览校验结果`,
      checkedAt: Date.now(),
      requestPreview: {
        catalogId: item.catalogId,
        targetId: item.runTargetId,
        endpoint,
        payload: testPayload
      },
      responsePreview: missing.length
        ? { missingRequiredSlots: missing }
        : {
            accepted: true,
            outputSchema: item.outputSchema || [],
            execution: item.executionRules || item.execution
          }
    };
  }

  function listProviderInputSlots(provider: ProviderRecord, entryId: string) {
    const entry = [...normalizeRunningHubCatalogItems(provider.rhApps, "app"), ...normalizeRunningHubCatalogItems(provider.rhWorkflows, "workflow")]
      .find((candidate) => candidate.id === entryId);
    return entry ? normalizeRunningHubInputSlots(entry.fields ?? []) : [];
  }

  return {
    listCatalogItems,
    listProviderCatalogItems,
    findCatalogItemDetail,
    createCatalogItem,
    updateCatalogItem,
    deleteCatalogItem,
    listGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    testCatalogItem,
    listProviderInputSlots
  };
}

type RhTaskValue = "image" | "video" | "audio" | "chat";

function normalizeTaskCapability(value: unknown): RhTaskValue | null {
  const text = safeText(value).toLowerCase();
  return text === "image" || text === "audio" || text === "chat" || text === "video" ? text : null;
}

function hasExplicitEmptyNodeInfoList(testPayload: unknown) {
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

function preserveJsonText(value: unknown, fallback = "{}") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    const text = value.trim();
    try {
      JSON.parse(text);
      return text;
    } catch {
      return fallback;
    }
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

