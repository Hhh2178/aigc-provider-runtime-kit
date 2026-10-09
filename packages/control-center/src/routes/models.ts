import { readJsonBody, sendJson, Router, HttpError } from "../http.js";
import type { ControlCenterServices } from "../index.js";
import type { ControlCenterConfig } from "../config.js";
import type { ModelRecord } from "../domain/types.js";
import { normalizeCapability, normalizeOptionalProtocol } from "../domain/protocol-catalog.js";
import { normalizeAdminModelRecord, parseInputCapabilities, normalizeModelCapabilityTags, normalizeModelTestState } from "../domain/model-normalize.js";
import { parseAdvancedConfig } from "../domain/model-normalize.js";
import { normalizeExecutionMode } from "../domain/model-normalize.js";
import { testModelConnectivity } from "../domain/provider-test.js";
import { safeJsonText, safeSlug, safeText } from "../util.js";

export function registerModelAdminRoutes(router: Router, deps: { config: ControlCenterConfig; services: ControlCenterServices }) {
  const { services } = deps;

  router.add("GET", "/api/admin/models", async ({ request, response, url }) => {
    void request;
    const providerId = safeText(url.searchParams.get("providerId"));
    const capability = safeText(url.searchParams.get("capability")).toLowerCase();
    const models = providerId
      ? await services.repository.readModelRecordsByProviderId(providerId)
      : await services.repository.readModelRecords();
    sendJson(response, models.filter((model) => !capability || normalizeCapability(model.capability) === capability));
  });

  router.add("POST", "/api/admin/models", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<Partial<ModelRecord>>(request);
    const now = Date.now();
    const capability = normalizeCapability(body.capability);
    const advancedConfig = parseAdvancedConfig(body.advancedConfig);
    const executionMode = normalizeExecutionMode(body.executionMode, advancedConfig, capability);
    advancedConfig.executionMode = executionMode;
    const providerId = safeSlug(body.providerId, "provider");
    const provider = await services.repository.findProviderRecordById(providerId);
    if (!provider) throw new HttpError(400, `Provider 不存在: ${providerId}`);
    const scopeModels = await services.repository.readModelRecordsByProviderId(providerId);
    const model: ModelRecord = {
      id: safeSlug(body.id, `model-${now}`),
      sortOrder: Number.isFinite(Number(body.sortOrder))
        ? Math.trunc(Number(body.sortOrder))
        : scopeModels
            .filter((item) => item.providerId === providerId && normalizeCapability(item.capability) === capability)
            .reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), -10) + 10,
      providerId,
      modelId: safeText(body.modelId, "model"),
      displayName: safeText(body.displayName, "新模型"),
      capability,
      enabled: Boolean(body.enabled),
      executionMode,
      inputProfile: safeText(body.inputProfile, "prompt"),
      inputCapabilities: { ...parseInputCapabilities(body.inputCapabilities, capability) },
      capabilityTags: normalizeModelCapabilityTags(body.capabilityTags, capability, body.modelId),
      testState: normalizeModelTestState(body.testState),
      parameterSchema: safeJsonText(body.parameterSchema, "{}"),
      advancedConfig,
      protocolOverride: normalizeOptionalProtocol(body.protocolOverride),
      createdAt: now,
      updatedAt: now
    };
    if ((await services.repository.findModelRecordById(model.id))) throw new HttpError(409, "模型 ID 已存在");
    const normalizedModel = normalizeAdminModelRecord(model);
    await services.repository.insertModelRecord(normalizedModel);
    if (admin) await services.appendAudit(admin, "model.create", "model", normalizedModel.id, `创建模型 ${normalizedModel.displayName}`, requestContext);
    sendJson(response, normalizedModel, 201);
  });

  router.add("POST", "/api/admin/models/reorder", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<{ providerId?: string; capability?: string; orderedIds?: string[] }>(request);
    const providerId = safeSlug(body.providerId, "");
    const capability = normalizeCapability(body.capability);
    if (!providerId) throw new HttpError(400, "缺少 Provider ID");
    const models = await services.repository.reorderModelRecords({
      providerId,
      capability,
      orderedIds: Array.isArray(body.orderedIds) ? body.orderedIds : []
    });
    if (admin) await services.appendAudit(admin, "models.reorder", "model", `${providerId}:${capability}`, "调整模型前台展示顺序", requestContext);
    sendJson(response, models);
  });

  router.add("POST", "/api/admin/models/:id/test", async ({ request, response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const body = await readJsonBody<{ kind?: string; autoApply?: boolean; confirmCost?: boolean }>(request);
    const model = await services.repository.findModelRecordById(id);
    if (!model) throw new HttpError(404, "模型不存在");
    const provider = await services.repository.findProviderRecordById(model.providerId);
    if (!provider) throw new HttpError(404, "Provider 不存在");
    const result = await testModelConnectivity(provider, model, safeText(body.kind, "chat"), {
      codec: services.codec,
      confirmCost: body.confirmCost === true
    });
    const updatedModel = await services.repository.updateModelRecord(id, (item) => {
      const testState = normalizeModelTestState({
        ...normalizeModelTestState(item.testState),
        [result.stateKey]: result.test
      });
      const currentTags = normalizeModelCapabilityTags(item.capabilityTags, item.capability, item.modelId);
      const nextTags = body.autoApply && result.test.ok
        ? [...new Set([...currentTags, ...(result.test.inferredTags || [])])]
        : currentTags;
      return {
        ...item,
        capabilityTags: nextTags,
        testState,
        updatedAt: Date.now()
      };
    });
    if (admin) await services.appendAudit(admin, "model.test", "model", id, `测试模型 ${updatedModel.displayName}: ${result.test.ok ? "ok" : "error"}`, requestContext);
    sendJson(response, result.test);
  });

  router.add("PATCH", "/api/admin/models/:id", async ({ request, response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const body = await readJsonBody<Partial<ModelRecord>>(request);
    const updated = await services.repository.updateModelRecord(id, (model) => {
      const nextCapability = body.capability === undefined ? model.capability : normalizeCapability(body.capability);
      const nextAdvancedConfig = body.advancedConfig === undefined
        ? parseAdvancedConfig(model.advancedConfig)
        : parseAdvancedConfig(body.advancedConfig);
      const nextExecutionMode = normalizeExecutionMode(
        body.executionMode === undefined ? model.executionMode : body.executionMode,
        nextAdvancedConfig,
        nextCapability
      );
      nextAdvancedConfig.executionMode = nextExecutionMode;
      const modelIdForTags = body.modelId === undefined ? model.modelId : body.modelId;
      return {
        ...model,
        sortOrder: body.sortOrder === undefined || !Number.isFinite(Number(body.sortOrder)) ? model.sortOrder : Math.trunc(Number(body.sortOrder)),
        providerId: body.providerId === undefined ? model.providerId : safeSlug(body.providerId, model.providerId),
        modelId: body.modelId === undefined ? model.modelId : safeText(body.modelId, model.modelId),
        displayName: body.displayName === undefined ? model.displayName : safeText(body.displayName, model.displayName),
        capability: nextCapability,
        enabled: body.enabled === undefined ? model.enabled : Boolean(body.enabled),
        executionMode: nextExecutionMode,
        inputProfile: body.inputProfile === undefined ? model.inputProfile : safeText(body.inputProfile, model.inputProfile),
        inputCapabilities: body.inputCapabilities === undefined
          ? parseInputCapabilities(model.inputCapabilities, nextCapability)
          : { ...parseInputCapabilities(body.inputCapabilities, nextCapability) },
        capabilityTags: body.capabilityTags === undefined
          ? normalizeModelCapabilityTags(model.capabilityTags, nextCapability, modelIdForTags)
          : normalizeModelCapabilityTags(body.capabilityTags, nextCapability, modelIdForTags),
        testState: body.testState === undefined ? normalizeModelTestState(model.testState) : normalizeModelTestState(body.testState),
        parameterSchema: body.parameterSchema === undefined ? model.parameterSchema : safeJsonText(body.parameterSchema, "{}"),
        advancedConfig: nextAdvancedConfig,
        protocolOverride: body.protocolOverride === undefined ? model.protocolOverride : normalizeOptionalProtocol(body.protocolOverride),
        updatedAt: Date.now()
      };
    });
    if (admin) await services.appendAudit(admin, "model.update", "model", id, `更新模型 ${updated.displayName}`, requestContext);
    sendJson(response, updated);
  });

  router.add("DELETE", "/api/admin/models/:id", async ({ response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const model = await services.repository.deleteModelRecord(id);
    if (admin) await services.appendAudit(admin, "model.delete", "model", id, `删除模型 ${model.displayName}`, requestContext);
    sendJson(response, { deleted: true, id });
  });
}
