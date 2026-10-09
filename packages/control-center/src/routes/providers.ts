import { readJsonBody, sendJson, Router, HttpError } from "../http.js";
import type { ControlCenterServices } from "../index.js";
import type { ControlCenterConfig } from "../config.js";
import type { ProviderRecord } from "../domain/types.js";
import { normalizeProviderProtocol } from "../domain/protocol-catalog.js";
import { fetchProviderModels, probeProvider } from "../domain/provider-probe.js";
import { normalizeRunningHubCatalogItems, runningHubCatalogId } from "../domain/runninghub/catalog.js";
import { createProviderSecretProjection, normalizeModelScopeLoras } from "../domain/provider-secrets.js";
import { importProviderModels } from "../domain/import-models.js";
import {
  normalizeAdminModelRecord,
  normalizeCapability,
  normalizeModelCapabilityTags,
  normalizeModelTestState,
  normalizeOptionalProtocol,
  inferModelCapabilityTags,
  parseAdvancedConfig as plainObject
} from "../domain/model-normalize.js";
import { safeSlug, safeText } from "../util.js";

export function registerProviderAdminRoutes(router: Router, deps: { config: ControlCenterConfig; services: ControlCenterServices }) {
  const { services } = deps;
  const codec = services.codec;
  const projection = createProviderSecretProjection(codec);

  router.add("GET", "/api/admin/providers", async ({ response, admin, requestContext }) => {
    const providers = await services.repository.readProviderRecords();
    await audit(admin, "providers.read", "provider", "providers-list", "查看 Provider 列表", requestContext);
    sendJson(response, providers.map((provider) => projection.toPublicProvider(provider)));
  });

  router.add("POST", "/api/admin/providers", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<Partial<ProviderRecord> & { apiKey?: string }>(request);
    const now = Date.now();
    const apiKey = safeText(body.apiKey);
    const providers = await services.repository.readProviderRecords();
    const nextSortOrder = providers.reduce((max, provider) => Math.max(max, Number(provider.sortOrder) || 0), -10) + 10;
    const provider: ProviderRecord = {
      id: safeSlug(body.id, `provider-${now}`),
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : nextSortOrder,
      name: safeText(body.name, "新服务商"),
      baseUrl: safeText(body.baseUrl),
      protocol: normalizeProviderProtocol(body.protocol),
      enabled: Boolean(body.enabled),
      apiKey: codec.encrypt(apiKey),
      apiKeyPreview: codec.preview(apiKey),
      rhApps: normalizeRunningHubCatalogItems(body.rhApps, "app"),
      rhWorkflows: normalizeRunningHubCatalogItems(body.rhWorkflows, "workflow"),
      rhKeyPool: projection.normalizeProviderSecretKeyPool(body.rhKeyPool),
      msLoras: normalizeModelScopeLoras(body.msLoras),
      note: safeText(body.note),
      createdAt: now,
      updatedAt: now
    };
    await services.repository.insertProviderRecord(provider);
    await audit(admin, "provider.create", "provider", provider.id, `创建 Provider ${provider.name}`, requestContext);
    sendJson(response, projection.toPublicProvider(provider), 201);
  });

  router.add("POST", "/api/admin/providers/reorder", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<{ orderedIds?: string[] }>(request);
    const providers = await services.repository.reorderProviderRecords(Array.isArray(body.orderedIds) ? body.orderedIds : []);
    await audit(admin, "providers.reorder", "provider", "providers-list", "调整 Provider 前台展示顺序", requestContext);
    sendJson(response, providers.map((provider) => projection.toPublicProvider(provider)));
  });

  router.add("POST", "/api/admin/providers/probe", async ({ request, response }) => {
    const body = await readJsonBody<Partial<ProviderRecord> & { apiKey?: string }>(request);
    sendJson(response, await probeProvider(body, { codec }));
  });

  router.add("POST", "/api/admin/providers/fetch-models", async ({ request, response }) => {
    const body = await readJsonBody<Partial<ProviderRecord> & { apiKey?: string }>(request);
    sendJson(response, await fetchProviderModels(body, { codec }));
  });

  router.add("POST", "/api/admin/providers/:id/probe", async ({ request, response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const body = await readJsonBody<Partial<ProviderRecord> & { apiKey?: string }>(request);
    const provider = await requireProvider(id);
    const result = await probeProvider({ ...provider, ...body }, { codec });
    await services.repository.updateProviderProbeResult(id, result, Date.now());
    await audit(admin, "provider.probe", "provider", id, `验证 Provider ${provider.name}: ${result.ok ? "ok" : "error"}`, requestContext);
    sendJson(response, result);
  });

  router.add("POST", "/api/admin/providers/:id/fetch-models", async ({ request, response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const body = await readJsonBody<Partial<ProviderRecord> & { apiKey?: string }>(request);
    const provider = await requireProvider(id);
    const result = await fetchProviderModels({ ...provider, ...body }, { codec });
    await services.repository.updateProviderLastFetchedAt(id, Date.now());
    await audit(admin, "provider.fetchModels", "provider", id, `拉取 Provider ${provider.name} 模型 ${result.total}`, requestContext);
    sendJson(response, result);
  });

  router.add("PATCH", "/api/admin/providers/:id", async ({ request, response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const body = await readJsonBody<Partial<ProviderRecord> & { clearApiKey?: boolean }>(request);
    const updated = await services.repository.updateProviderRecord(id, (provider) => {
      const next: ProviderRecord = {
        ...provider,
        name: body.name === undefined ? provider.name : safeText(body.name, provider.name),
        baseUrl: body.baseUrl === undefined ? provider.baseUrl : safeText(body.baseUrl),
        protocol: body.protocol === undefined ? provider.protocol : normalizeProviderProtocol(body.protocol),
        enabled: body.enabled === undefined ? provider.enabled : Boolean(body.enabled),
        sortOrder: body.sortOrder === undefined || !Number.isFinite(Number(body.sortOrder)) ? provider.sortOrder : Math.trunc(Number(body.sortOrder)),
        rhApps: body.rhApps === undefined ? provider.rhApps : normalizeRunningHubCatalogItems(body.rhApps, "app"),
        rhWorkflows: body.rhWorkflows === undefined ? provider.rhWorkflows : normalizeRunningHubCatalogItems(body.rhWorkflows, "workflow"),
        rhKeyPool: body.rhKeyPool === undefined ? provider.rhKeyPool : projection.normalizeProviderSecretKeyPool(body.rhKeyPool),
        msLoras: body.msLoras === undefined ? provider.msLoras : normalizeModelScopeLoras(body.msLoras),
        note: body.note === undefined ? provider.note : safeText(body.note),
        updatedAt: Date.now()
      };
      if (body.clearApiKey) {
        delete next.apiKey;
        delete next.apiKeyPreview;
      }
      if (body.apiKey) {
        const apiKey = safeText(body.apiKey);
        next.apiKey = codec.encrypt(apiKey);
        next.apiKeyPreview = codec.preview(apiKey);
      }
      return next;
    });
    await audit(admin, "provider.update", "provider", id, `更新 Provider ${updated.name}`, requestContext);
    sendJson(response, projection.toPublicProvider(updated));
  });

  router.add("DELETE", "/api/admin/providers/:id", async ({ response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const provider = await services.repository.deleteProviderRecord(id);
    await audit(admin, "provider.delete", "provider", id, `删除 Provider ${provider.name}`, requestContext);
    sendJson(response, { deleted: true, id });
  });

  // -- key pool -----------------------------------------------------------

  router.add("GET", "/api/admin/providers/:id/runninghub/key-pool", async ({ response, params }) => {
    const provider = await requireProvider(String(params.id ?? ""));
    sendJson(response, projection.toPublicRunningHubKeyPool(provider.rhKeyPool));
  });

  router.add("PUT", "/api/admin/providers/:id/runninghub/key-pool", async ({ request, response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const body = await readJsonBody<{ rhKeyPool?: unknown }>(request);
    const provider = await requireProvider(id);
    const existingPool = projection.normalizeProviderSecretKeyPool(provider.rhKeyPool);
    const existingById = new Map(existingPool.map((item) => [item.id, item]));
    const nextPool = projection.normalizeProviderSecretKeyPool(body.rhKeyPool).map((item) => ({
      ...item,
      apiKey: item.apiKey || existingById.get(item.id)?.apiKey,
      apiKeyPreview: item.apiKeyPreview || existingById.get(item.id)?.apiKeyPreview,
      createdAt: item.createdAt || existingById.get(item.id)?.createdAt || Date.now(),
      updatedAt: Date.now()
    }));
    const defaultKeyId = nextPool.find((item) => item.isDefault === true)?.id || "";
    const normalizedDefaultPool = nextPool.map((item, index) => ({
      ...item,
      isDefault: defaultKeyId ? item.id === defaultKeyId : index === 0
    }));
    const updated = await services.repository.updateProviderRhCatalog(id, (current) => ({
      ...current,
      rhKeyPool: normalizedDefaultPool,
      updatedAt: Date.now()
    }));
    void provider;
    await audit(admin, "provider.runninghub.keyPool.update", "provider", id, `更新 Provider RH Key 池`, requestContext);
    sendJson(response, projection.toPublicRunningHubKeyPool(updated.rhKeyPool));
  });

  router.add("DELETE", "/api/admin/providers/:id/runninghub/key-pool/:keyId", async ({ response, params, admin, requestContext }) => {
    const id = String(params.id ?? "");
    const keyId = String(params.keyId ?? "");
    const updated = await services.repository.updateProviderRhCatalog(id, (current) => ({
      ...current,
      rhKeyPool: projection.normalizeProviderSecretKeyPool(current.rhKeyPool).filter((item) => item.id !== keyId),
      updatedAt: Date.now()
    }));
    await audit(admin, "provider.runninghub.keyPool.delete", "provider", id, `删除 Provider RH Key ${keyId}`, requestContext);
    sendJson(response, projection.toPublicRunningHubKeyPool(updated.rhKeyPool));
  });

  // -- RH catalog read (denormalized view) ---------------------------------

  router.add("GET", "/api/admin/providers/:id/runninghub/catalog", async ({ response, params }) => {
    const provider = await requireProvider(String(params.id ?? ""));
    const apps = normalizeRunningHubCatalogItems(provider.rhApps, "app");
    const workflows = normalizeRunningHubCatalogItems(provider.rhWorkflows, "workflow");
    sendJson(response, {
      items: [...workflows, ...apps].map((entry) => ({ ...entry, catalogId: runningHubCatalogId(provider.id, entry.kind || "workflow", entry.id) }))
    });
  });

  // -- import -------------------------------------------------------------

  router.add("POST", "/api/admin/providers/:id/import-models", async ({ request, response, params, admin, requestContext }) => {
    const providerId = String(params.id ?? "");
    await requireProvider(providerId);
    const body = await readJsonBody<{ models?: Array<{ modelId?: string; capability?: string; displayName?: string; protocolOverride?: string; capabilityTags?: unknown }> }>(request);
    const now = Date.now();
    const incoming = Array.isArray(body.models) ? body.models : [];
    const existing = await services.repository.readModelRecords();
    const imported = importProviderModels({ providerId, now, existing, incoming, deps: importDeps });
    await services.repository.importProviderModels(providerId, imported);
    await audit(admin, "model.import", "provider", providerId, `导入模型 ${imported.imported} 个`, requestContext);
    sendJson(response, { imported: imported.imported, models: imported.nextModels.filter((model) => model.providerId === providerId) });
  });

  async function requireProvider(id: string) {
    const provider = await services.repository.findProviderRecordById(id);
    if (!provider) throw new HttpError(404, "Provider 不存在");
    return provider;
  }

  async function audit(
    admin: Parameters<typeof services.appendAudit>[0] | undefined,
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
    requestContext: Parameters<typeof services.appendAudit>[5],
  ) {
    if (admin) await services.appendAudit(admin, action, targetType, targetId, summary, requestContext);
  }
}

const importDeps = {
  normalizeCapability,
  normalizeModelCapabilityTags,
  inferModelCapabilityTags,
  normalizeOptionalProtocol,
  normalizeAdminModelRecord,
  normalizeModelTestState,
  plainObject,
  safeSlug,
  safeText
};
