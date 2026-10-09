import type { RhKeyPoolItemRecord, ProviderRecord, PublicProviderRecord, ModelScopeLora, RhKeyPoolSummary } from "./types.js";
import type { RhCatalogEntry, RhCatalogGroup } from "./runninghub/catalog.js";
import { normalizeProviderProtocol } from "./protocol-catalog.js";
import { normalizeCatalogSortOrder } from "./model-normalize.js";
import { safeSlug, safeText } from "../util.js";
import type { SecretCodec } from "../crypto.js";
import { normalizeRunningHubCatalogItems, normalizeRunningHubGroups } from "./runninghub/catalog.js";

export function createProviderSecretProjection(codec: SecretCodec) {
  function normalizeRunningHubKeyPool(value: unknown): RhKeyPoolItemRecord[] {
    const normalized = (Array.isArray(value) ? value : [])
      .flatMap((item) => {
        const row = item && typeof item === "object" ? item as Record<string, unknown> : null;
        if (!row) return [];
        const id = safeSlug(row.id, "");
        if (!id) return [];
        const apiKey = safeText(row.apiKey);
        const previewSource = codec.decrypt(apiKey) || apiKey;
        const apiKeyPreview = safeText(row.apiKeyPreview, previewSource ? codec.preview(previewSource) : "");
        return {
          id,
          note: safeText(row.note),
          ...(apiKey ? { apiKey } : {}),
          apiKeyPreview,
          maxConcurrency: Math.max(1, Number(row.maxConcurrency) || 1),
          enabled: row.enabled !== false,
          isDefault: row.isDefault === true,
          standardModelApi: typeof row.standardModelApi === "boolean"
            ? row.standardModelApi
            : /企业级|enterprise/i.test(safeText(row.note)),
          ...(Number(row.currentInFlight) > 0 ? { currentInFlight: Math.max(0, Number(row.currentInFlight)) } : {}),
          createdAt: Math.max(0, Number(row.createdAt) || 0),
          updatedAt: Math.max(0, Number(row.updatedAt) || 0)
        } satisfies RhKeyPoolItemRecord;
      });
    const firstDefaultIndex = normalized.findIndex((item) => item.isDefault);
    return normalized.map((item, index) => ({
      ...item,
      isDefault: firstDefaultIndex >= 0 ? index === firstDefaultIndex : false
    }));
  }

  function normalizeProviderSecretKeyPool(value: unknown): RhKeyPoolItemRecord[] {
    return normalizeRunningHubKeyPool(value).map((item) => {
      const rawApiKey = safeText(item.apiKey);
      if (!rawApiKey) return item;
      if (rawApiKey.startsWith("enc:v1:")) {
        return item.apiKeyPreview ? item : { ...item, apiKeyPreview: codec.preview(rawApiKey) };
      }
      return {
        ...item,
        apiKey: codec.encrypt(rawApiKey),
        apiKeyPreview: codec.preview(rawApiKey)
      };
    });
  }

  function normalizeProviderSecret(provider: ProviderRecord): ProviderRecord {
    const rhKeyPool = normalizeProviderSecretKeyPool(provider.rhKeyPool);
    const rhGroups = normalizeRhGroups(provider.rhGroups, provider.id);
    const validGroupIds = new Set(rhGroups.map((group) => group.id));
    const rhApps = normalizeRhEntries(provider.rhApps, "app", validGroupIds);
    const rhWorkflows = normalizeRhEntries(provider.rhWorkflows, "workflow", validGroupIds);
    if (!provider.apiKey) return { ...provider, rhKeyPool, rhGroups, rhApps, rhWorkflows };
    if (provider.apiKey.startsWith("enc:v1:")) {
      return provider.apiKeyPreview
        ? { ...provider, rhKeyPool, rhGroups, rhApps, rhWorkflows }
        : { ...provider, rhKeyPool, rhGroups, rhApps, rhWorkflows, apiKeyPreview: codec.preview(provider.apiKey) };
    }
    const raw = provider.apiKey;
    return {
      ...provider,
      rhKeyPool,
      rhGroups,
      rhApps,
      rhWorkflows,
      apiKey: codec.encrypt(raw),
      apiKeyPreview: codec.preview(raw)
    };
  }

  function toPublicRunningHubKeyPool(value: unknown): RhKeyPoolItemRecord[] {
    return normalizeRunningHubKeyPool(value).map((item) => ({
      id: item.id,
      note: item.note,
      ...(item.apiKeyPreview ? { apiKeyPreview: item.apiKeyPreview } : {}),
      maxConcurrency: item.maxConcurrency,
      enabled: item.enabled,
      isDefault: item.isDefault === true,
      standardModelApi: item.standardModelApi,
      ...(item.currentInFlight !== undefined ? { currentInFlight: item.currentInFlight } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));
  }

  function summarizeRunningHubKeyPool(items: RhKeyPoolItemRecord[]): RhKeyPoolSummary {
    const enabledItems = items.filter((item) => item.enabled);
    return {
      totalKeyCount: items.length,
      enabledKeyCount: enabledItems.length,
      totalConcurrency: enabledItems.reduce((sum, item) => sum + Math.max(1, Number(item.maxConcurrency) || 1), 0),
      activeInFlight: enabledItems.reduce((sum, item) => sum + Math.max(0, Number(item.currentInFlight) || 0), 0)
    };
  }

  function toPublicProvider(provider: ProviderRecord): PublicProviderRecord {
    const rhKeyPool = toPublicRunningHubKeyPool(provider.rhKeyPool);
    return {
      id: provider.id,
      sortOrder: normalizeCatalogSortOrder(provider.sortOrder),
      name: provider.name,
      baseUrl: provider.baseUrl,
      protocol: normalizeProviderProtocol(provider.protocol),
      enabled: provider.enabled,
      hasApiKey: Boolean(provider.apiKey),
      apiKeyPreview: provider.apiKeyPreview || codec.preview(provider.apiKey || ""),
      lastProbeStatus: provider.lastProbeStatus || "",
      lastProbeMessage: provider.lastProbeMessage || "",
      lastFetchedAt: provider.lastFetchedAt || 0,
      rhApps: normalizeRhEntries(provider.rhApps, "app"),
      rhWorkflows: normalizeRhEntries(provider.rhWorkflows, "workflow"),
      rhGroups: normalizeRhGroups(provider.rhGroups, provider.id),
      rhKeyPool,
      rhKeyPoolSummary: summarizeRunningHubKeyPool(rhKeyPool),
      msLoras: normalizeModelScopeLoras(provider.msLoras),
      note: provider.note || "",
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    };
  }

  function buildEffectiveRunningHubKeyPool(provider: ProviderRecord, legacyFallbackConcurrency = 1): RhKeyPoolItemRecord[] {
    const normalizedPool = normalizeRunningHubKeyPool(provider.rhKeyPool).filter((item) => item.enabled && safeText(item.apiKey));
    if (normalizedPool.length > 0) return normalizedPool;
    const legacyApiKey = safeText(provider.apiKey);
    if (!legacyApiKey) return [];
    const previewSource = codec.decrypt(legacyApiKey) || legacyApiKey;
    const now = Date.now();
    return [{
      id: "legacy-default",
      note: "兼容单 Key",
      apiKey: legacyApiKey,
      apiKeyPreview: provider.apiKeyPreview || codec.preview(previewSource),
      maxConcurrency: Math.max(1, Number(legacyFallbackConcurrency) || 1),
      enabled: true,
      isDefault: true,
      standardModelApi: false,
      currentInFlight: 0,
      createdAt: provider.createdAt || now,
      updatedAt: provider.updatedAt || now
    }];
  }

  return {
    normalizeRunningHubKeyPool,
    normalizeProviderSecretKeyPool,
    normalizeProviderSecret,
    toPublicRunningHubKeyPool,
    summarizeRunningHubKeyPool,
    toPublicProvider,
    buildEffectiveRunningHubKeyPool
  };
}

/**
 * Thin aliases over the runninghub catalog normalizers so projection code can
 * read naturally. Import direction stays one-way (secrets -> catalog).
 */
function normalizeRhEntries(value: unknown, kind: "app" | "workflow", validGroupIds?: Set<string>): RhCatalogEntry[] {
  return normalizeRunningHubCatalogItems(value, kind, validGroupIds);
}

function normalizeRhGroups(value: unknown, providerId: string, now?: number): RhCatalogGroup[] {
  return normalizeRunningHubGroups(value, providerId, now);
}

export function normalizeModelScopeLoras(value: unknown): ModelScopeLora[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const id = safeText(row.id);
      if (!id) return null;
      const strength = Number(row.strength);
      return {
        id,
        name: safeText(row.name),
        targetModel: safeText(row.targetModel || row.target_model || row.model, "Tongyi-MAI/Z-Image-Turbo"),
        strength: Number.isFinite(strength) ? Math.max(0, Math.min(2, strength)) : 0.8,
        enabled: row.enabled === undefined ? true : Boolean(row.enabled),
        note: safeText(row.note)
      } satisfies ModelScopeLora;
    })
    .filter(Boolean) as ModelScopeLora[];
}
