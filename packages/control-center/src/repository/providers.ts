import type { ProviderRecord, ModelRecord, ProviderModelImportResult, ModelScopeLora, ModelCapabilityTag, ModelExecutionMode } from "../domain/types.js";
import { normalizeRunningHubCatalogItems, normalizeRunningHubGroups } from "../domain/runninghub/catalog.js";
import type { SecretCodec } from "../crypto.js";
import { createProviderSecretProjection } from "../domain/provider-secrets.js";
import {
  normalizeCatalogSortOrder,
  sortByCatalogDisplayOrder,
  applyCatalogDisplayOrder,
  normalizeCapability,
  normalizeAdminModelRecord
} from "../domain/model-normalize.js";
import { normalizeProviderProtocol } from "../domain/protocol-catalog.js";
import type { SqlExecutor } from "../db.js";
import { safeText, millisToDate, dateToMillis, plainObject } from "../util.js";

export interface ProviderRepository {
  readProviderRecords(): Promise<ProviderRecord[]>;
  readProviderRecordsByProtocol(protocol: string): Promise<ProviderRecord[]>;
  findProviderRecordById(providerId: string): Promise<ProviderRecord | null>;
  findProviderRecordByNaturalKey(name: string): Promise<ProviderRecord | null>;
  insertProviderRecord(provider: ProviderRecord): Promise<ProviderRecord>;
  updateProviderRecord(providerId: string, transform: (provider: ProviderRecord) => ProviderRecord): Promise<ProviderRecord>;
  deleteProviderRecord(providerId: string): Promise<ProviderRecord>;
  updateProviderProbeResult(providerId: string, result: { ok?: boolean; message?: string }, now: number): Promise<void>;
  updateProviderLastFetchedAt(providerId: string, now: number): Promise<void>;
  updateProviderRhCatalog(providerId: string, transform: (provider: ProviderRecord) => ProviderRecord): Promise<ProviderRecord>;
  readModelRecords(): Promise<ModelRecord[]>;
  readEnabledModelRecords(): Promise<ModelRecord[]>;
  readModelRecordsByProviderId(providerId: string): Promise<ModelRecord[]>;
  findModelRecordById(modelId: string): Promise<ModelRecord | null>;
  findModelRecordByNaturalKey(providerId: string, capability: unknown, modelId: string): Promise<ModelRecord | null>;
  insertModelRecord(model: ModelRecord): Promise<ModelRecord>;
  updateModelRecord(modelId: string, transform: (model: ModelRecord) => ModelRecord): Promise<ModelRecord>;
  deleteModelRecord(modelId: string): Promise<ModelRecord>;
  importProviderModels(providerId: string, importResult: ProviderModelImportResult): Promise<ProviderModelImportResult>;
  reorderProviderRecords(orderedIds: string[]): Promise<ProviderRecord[]>;
  reorderModelRecords(input: { providerId: string; capability: string; orderedIds: string[] }): Promise<ModelRecord[]>;
  upsertModelRecordByProviderName(providerName: string, model: ModelRecord): Promise<ModelRecord>;
}

const PROVIDER_SELECT = `
select id, tenant_id, sort_order, name, base_url, protocol, enabled, api_key_cipher, api_key_preview,
  last_probe_status, last_probe_message, last_fetched_at, rh_apps, rh_workflows, rh_groups, rh_key_pool, ms_loras, note, created_at, updated_at
from cc_providers`;

const MODEL_SELECT = `
select id, tenant_id, sort_order, provider_id, model_id, display_name, capability, enabled, execution_mode,
  input_profile, input_capabilities, capability_tags, test_state, parameter_schema, advanced_config, protocol_override, created_at, updated_at
from cc_models`;

export function createProviderRepository(executor: SqlExecutor, codec: SecretCodec, tenantId: string): ProviderRepository {
  const projection = createProviderSecretProjection(codec);

  function toProviderRecordFromRow(row: Record<string, unknown>): ProviderRecord {
    return projection.normalizeProviderSecret({
      id: String(row.id ?? ""),
      sortOrder: Number(row.sort_order ?? 0),
      name: String(row.name ?? ""),
      baseUrl: String(row.base_url ?? ""),
      protocol: normalizeProviderProtocol(row.protocol),
      enabled: row.enabled === true,
      apiKey: String(row.api_key_cipher ?? "") || undefined,
      apiKeyPreview: String(row.api_key_preview ?? "") || undefined,
      lastProbeStatus: String(row.last_probe_status ?? "") || undefined,
      lastProbeMessage: String(row.last_probe_message ?? "") || undefined,
      lastFetchedAt: row.last_fetched_at ? dateToMillis(row.last_fetched_at) : undefined,
      rhApps: normalizeRunningHubCatalogItems(row.rh_apps, "app"),
      rhWorkflows: normalizeRunningHubCatalogItems(row.rh_workflows, "workflow"),
      rhGroups: normalizeRunningHubGroups(row.rh_groups, String(row.id ?? "")),
      rhKeyPool: projection.normalizeRunningHubKeyPool(row.rh_key_pool),
      msLoras: plainArray(row.ms_loras) as ModelScopeLora[],
      note: String(row.note ?? ""),
      createdAt: dateToMillis(row.created_at),
      updatedAt: dateToMillis(row.updated_at)
    });
  }

  function toModelRecordFromRow(row: Record<string, unknown>): ModelRecord {
    return normalizeAdminModelRecord({
      id: String(row.id ?? ""),
      sortOrder: Number(row.sort_order ?? 0),
      providerId: String(row.provider_id ?? ""),
      modelId: String(row.model_id ?? ""),
      displayName: String(row.display_name ?? ""),
      capability: normalizeCapability(row.capability),
      enabled: row.enabled === true,
      executionMode: (String(row.execution_mode ?? "") || undefined) as ModelExecutionMode | undefined,
      inputProfile: String(row.input_profile ?? "prompt"),
      inputCapabilities: plainObject(row.input_capabilities),
      capabilityTags: plainArray(row.capability_tags) as ModelCapabilityTag[],
      testState: plainObject(row.test_state),
      parameterSchema: typeof row.parameter_schema === "string" ? row.parameter_schema : JSON.stringify(row.parameter_schema ?? {}),
      advancedConfig: plainObject(row.advanced_config),
      protocolOverride: String(row.protocol_override ?? "") || undefined,
      createdAt: dateToMillis(row.created_at),
      updatedAt: dateToMillis(row.updated_at)
    });
  }

  async function upsertProviderRecordPostgres(provider: ProviderRecord) {
    const normalized = projection.normalizeProviderSecret(provider);
    await executor.query(
      `insert into cc_providers (id, tenant_id, sort_order, name, base_url, protocol, enabled, api_key_cipher, api_key_preview, last_probe_status, last_probe_message, last_fetched_at, rh_apps, rh_workflows, rh_groups, rh_key_pool, ms_loras, note, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20)
       on conflict (id) do update set
         tenant_id = excluded.tenant_id, sort_order = excluded.sort_order, name = excluded.name, base_url = excluded.base_url, protocol = excluded.protocol,
         enabled = excluded.enabled, api_key_cipher = excluded.api_key_cipher, api_key_preview = excluded.api_key_preview,
         last_probe_status = excluded.last_probe_status, last_probe_message = excluded.last_probe_message, last_fetched_at = excluded.last_fetched_at,
         rh_apps = excluded.rh_apps, rh_workflows = excluded.rh_workflows, rh_groups = excluded.rh_groups, rh_key_pool = excluded.rh_key_pool,
         ms_loras = excluded.ms_loras, note = excluded.note, updated_at = excluded.updated_at`,
      [
        normalized.id,
        tenantId,
        normalizeCatalogSortOrder(normalized.sortOrder),
        normalized.name,
        normalized.baseUrl,
        normalizeProviderProtocol(normalized.protocol),
        normalized.enabled,
        normalized.apiKey || "",
        normalized.apiKeyPreview || "",
        normalized.lastProbeStatus || "",
        normalized.lastProbeMessage || "",
        normalized.lastFetchedAt ? millisToDate(normalized.lastFetchedAt) : null,
        JSON.stringify(normalizeRunningHubCatalogItems(normalized.rhApps, "app")),
        JSON.stringify(normalizeRunningHubCatalogItems(normalized.rhWorkflows, "workflow")),
        JSON.stringify(normalizeRunningHubGroups(normalized.rhGroups, normalized.id)),
        JSON.stringify(projection.normalizeProviderSecretKeyPool(normalized.rhKeyPool)),
        JSON.stringify(normalized.msLoras || []),
        normalized.note || "",
        millisToDate(normalized.createdAt),
        millisToDate(normalized.updatedAt)
      ]
    );
  }

  async function upsertModelRecordPostgres(model: ModelRecord) {
    const normalized = normalizeAdminModelRecord(model);
    await executor.query(
      `insert into cc_models (id, tenant_id, sort_order, provider_id, model_id, display_name, capability, enabled, execution_mode, input_profile, input_capabilities, capability_tags, test_state, parameter_schema, advanced_config, protocol_override, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18)
       on conflict (id) do update set
         tenant_id = excluded.tenant_id, sort_order = excluded.sort_order, provider_id = excluded.provider_id, model_id = excluded.model_id,
         display_name = excluded.display_name, capability = excluded.capability, enabled = excluded.enabled, execution_mode = excluded.execution_mode,
         input_profile = excluded.input_profile, input_capabilities = excluded.input_capabilities, capability_tags = excluded.capability_tags,
         test_state = excluded.test_state, parameter_schema = excluded.parameter_schema, advanced_config = excluded.advanced_config,
         protocol_override = excluded.protocol_override, updated_at = excluded.updated_at`,
      [
        normalized.id,
        tenantId,
        normalizeCatalogSortOrder(normalized.sortOrder),
        normalized.providerId,
        normalized.modelId,
        normalized.displayName,
        normalizeCapability(normalized.capability),
        normalized.enabled,
        normalized.executionMode || "worker_queue",
        normalized.inputProfile,
        JSON.stringify(normalized.inputCapabilities),
        JSON.stringify(normalized.capabilityTags || []),
        JSON.stringify(normalized.testState || {}),
        normalized.parameterSchema || "{}",
        JSON.stringify(normalized.advancedConfig),
        normalized.protocolOverride || "",
        millisToDate(normalized.createdAt),
        millisToDate(normalized.updatedAt)
      ]
    );
  }

  const repository: ProviderRepository = {
    async readProviderRecords() {
      const result = await executor.query(`${PROVIDER_SELECT} order by sort_order asc, created_at desc, id asc`);
      return result.rows.map(toProviderRecordFromRow);
    },
    async readProviderRecordsByProtocol(protocol) {
      const normalizedProtocol = normalizeProviderProtocol(protocol);
      const result = await executor.query(`${PROVIDER_SELECT} where lower(protocol) = lower($1) order by sort_order asc, created_at desc, id asc`, [normalizedProtocol]);
      return result.rows.map(toProviderRecordFromRow);
    },
    async findProviderRecordById(providerId) {
      const normalizedProviderId = safeText(providerId);
      const result = await executor.query(`${PROVIDER_SELECT} where id = $1 limit 1`, [normalizedProviderId]);
      return result.rows[0] ? toProviderRecordFromRow(result.rows[0]) : null;
    },
    async findProviderRecordByNaturalKey(name) {
      const normalizedName = safeText(name).toLowerCase();
      const result = await executor.query(`${PROVIDER_SELECT} where lower(name) = lower($1) limit 1`, [name]);
      return result.rows[0] ? toProviderRecordFromRow(result.rows[0]) : null;
    },
    async insertProviderRecord(provider) {
      const normalized = projection.normalizeProviderSecret(provider);
      await upsertProviderRecordPostgres(normalized);
      return normalized;
    },
    async updateProviderRecord(providerId, transform) {
      const current = await repository.findProviderRecordById(providerId);
      if (!current) throw new Error("Provider 不存在");
      const updated = projection.normalizeProviderSecret(transform(current));
      await upsertProviderRecordPostgres(updated);
      return updated;
    },
    async deleteProviderRecord(providerId) {
      const current = await repository.findProviderRecordById(providerId);
      if (!current) throw new Error("Provider 不存在");
      await executor.query("delete from cc_providers where id = $1", [providerId]);
      return current;
    },
    async updateProviderProbeResult(providerId, result, now) {
      await executor.query("update cc_providers set last_probe_status = $2, last_probe_message = $3, updated_at = $4 where id = $1", [
        providerId,
        result.ok ? "ok" : "error",
        safeText(result.message),
        millisToDate(now)
      ]);
    },
    async updateProviderLastFetchedAt(providerId, now) {
      await executor.query("update cc_providers set last_fetched_at = $2, updated_at = $2 where id = $1", [providerId, millisToDate(now)]);
    },
    async updateProviderRhCatalog(providerId, transform) {
      const current = await repository.findProviderRecordById(providerId);
      if (!current) throw new Error("Provider 不存在");
      const updated = projection.normalizeProviderSecret(transform(current));
      await executor.query(
        "update cc_providers set rh_apps = $2::jsonb, rh_workflows = $3::jsonb, rh_groups = $4::jsonb, rh_key_pool = $5::jsonb, ms_loras = $6::jsonb, updated_at = $7 where id = $1",
        [
          providerId,
          JSON.stringify(normalizeRunningHubCatalogItems(updated.rhApps, "app")),
          JSON.stringify(normalizeRunningHubCatalogItems(updated.rhWorkflows, "workflow")),
          JSON.stringify(normalizeRunningHubGroups(updated.rhGroups, updated.id)),
          JSON.stringify(projection.normalizeProviderSecretKeyPool(updated.rhKeyPool)),
          JSON.stringify(updated.msLoras || []),
          millisToDate(updated.updatedAt)
        ]
      );
      return updated;
    },
    async readModelRecords() {
      const result = await executor.query(`${MODEL_SELECT} order by sort_order asc, created_at desc, id asc`);
      return result.rows.map(toModelRecordFromRow);
    },
    async readEnabledModelRecords() {
      const result = await executor.query(`${MODEL_SELECT} where enabled = true order by sort_order asc, created_at desc, id asc`);
      return result.rows.map(toModelRecordFromRow);
    },
    async readModelRecordsByProviderId(providerId) {
      const normalizedProviderId = safeText(providerId);
      const result = await executor.query(`${MODEL_SELECT} where provider_id = $1 order by sort_order asc, created_at desc, id asc`, [normalizedProviderId]);
      return result.rows.map(toModelRecordFromRow);
    },
    async findModelRecordById(modelId) {
      const normalizedModelRecordId = safeText(modelId);
      const result = await executor.query(`${MODEL_SELECT} where id = $1 limit 1`, [normalizedModelRecordId]);
      return result.rows[0] ? toModelRecordFromRow(result.rows[0]) : null;
    },
    async findModelRecordByNaturalKey(providerId, capability, modelId) {
      const normalizedProviderId = safeText(providerId);
      const normalizedCapability = normalizeCapability(capability);
      const normalizedModelId = safeText(modelId).toLowerCase();
      const result = await executor.query(
        `${MODEL_SELECT} where provider_id = $1 and capability = $2 and lower(model_id) = lower($3) limit 1`,
        [normalizedProviderId, normalizedCapability, normalizedModelId]
      );
      return result.rows[0] ? toModelRecordFromRow(result.rows[0]) : null;
    },
    async insertModelRecord(model) {
      const normalized = normalizeAdminModelRecord(model);
      await upsertModelRecordPostgres(normalized);
      return normalized;
    },
    async updateModelRecord(modelId, transform) {
      const current = await repository.findModelRecordById(modelId);
      if (!current) throw new Error("模型不存在");
      const updated = normalizeAdminModelRecord(transform(current));
      await upsertModelRecordPostgres(updated);
      return updated;
    },
    async deleteModelRecord(modelId) {
      const current = await repository.findModelRecordById(modelId);
      if (!current) throw new Error("模型不存在");
      await executor.query("delete from cc_models where id = $1", [modelId]);
      return current;
    },
    async importProviderModels(providerId, importResult) {
      for (const model of importResult.touchedModels) await upsertModelRecordPostgres(model);
      return importResult;
    },
    async reorderProviderRecords(orderedIds) {
      const current = await repository.readProviderRecords();
      const reordered = sortByCatalogDisplayOrder(applyCatalogDisplayOrder(current, orderedIds));
      for (const provider of reordered) {
        await executor.query(
          "update cc_providers set sort_order = $2 where id = $1",
          [provider.id, normalizeCatalogSortOrder(provider.sortOrder)]
        );
      }
      return reordered;
    },
    async reorderModelRecords(input) {
      const providerId = safeText(input.providerId);
      const capability = normalizeCapability(input.capability);
      const allModels = await repository.readModelRecords();
      const scoped = allModels.filter((model) => model.providerId === providerId && normalizeCapability(model.capability) === capability);
      const reordered = sortByCatalogDisplayOrder(applyCatalogDisplayOrder(scoped, input.orderedIds));
      for (const model of reordered) {
        await executor.query(
          "update cc_models set sort_order = $2 where id = $1",
          [model.id, normalizeCatalogSortOrder(model.sortOrder)]
        );
      }
      return reordered;
    },
    async upsertModelRecordByProviderName(providerName, model) {
      const provider = await repository.findProviderRecordByNaturalKey(providerName);
      if (!provider) throw new Error(`目标环境缺少服务商 ${providerName}，无法写入模型`);
      const existing = await repository.findModelRecordByNaturalKey(provider.id, model.capability, model.modelId);
      const normalized = normalizeAdminModelRecord({ ...model, id: existing?.id || model.id, providerId: provider.id, createdAt: existing?.createdAt || model.createdAt });
      if (existing) return repository.updateModelRecord(existing.id, () => normalized);
      return repository.insertModelRecord(normalized);
    }
  };

  return repository;
}

function plainArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
