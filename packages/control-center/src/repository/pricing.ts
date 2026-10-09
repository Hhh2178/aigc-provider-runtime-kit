import type { SqlExecutor } from "../db.js";
import { computeTaskCost, resolvePricingForTask, type PricingRecord, type PricingScope } from "../domain/cost.js";
import { dateToMillis, safeText, millisToDate } from "../util.js";
import { randomUUID } from "node:crypto";

const PRICING_SELECT = "select * from cc_model_pricing";

export function createPricingRepository(executor: SqlExecutor, tenantId: string): PricingRepositoryShape {
  function fromRow(row: Record<string, unknown>): PricingRecord {
    return {
      id: String(row.id ?? ""),
      scope: String(row.scope ?? "model") === "rh_target" ? "rh_target" : "model",
      providerId: String(row.provider_id ?? ""),
      modelRecordId: String(row.model_record_id ?? ""),
      runTargetId: String(row.run_target_id ?? ""),
      kind: String(row.kind ?? "per_request") === "per_second" ? "per_second" : "per_request",
      unitPrice: Number(row.unit_price ?? 0),
      perSecondPrice: Number(row.per_second_price ?? 0),
      currency: String(row.currency ?? "CNY"),
      enabled: row.enabled !== false,
      createdAt: row.created_at ? dateToMillis(row.created_at) : undefined,
      updatedAt: row.updated_at ? dateToMillis(row.updated_at) : undefined
    };
  }

  async function upsertPricing(pricing: PricingRecord) {
    await executor.query(
      `insert into cc_model_pricing (id, tenant_id, scope, provider_id, model_record_id, run_target_id, kind, unit_price, per_second_price, currency, enabled, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set kind = excluded.kind, unit_price = excluded.unit_price, per_second_price = excluded.per_second_price,
         currency = excluded.currency, enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [
        pricing.id,
        tenantId,
        pricing.scope,
        pricing.providerId,
        pricing.modelRecordId,
        pricing.runTargetId,
        pricing.kind,
        pricing.unitPrice,
        pricing.perSecondPrice,
        pricing.currency,
        pricing.enabled,
        millisToDate(pricing.createdAt ?? Date.now()),
        millisToDate(pricing.updatedAt ?? Date.now())
      ]
    );
    return pricing;
  }

  return {
    upsertPricing,
    async listPricing(providerId) {
      const params: unknown[] = [tenantId];
      let where = "tenant_id = $1";
      if (providerId) {
        params.push(providerId);
        where += " and provider_id = $2";
      }
      const result = await executor.query(`${PRICING_SELECT} where ${where} order by scope, provider_id, model_record_id, run_target_id`, params);
      return result.rows.map(fromRow);
    },
    async deletePricing(id) {
      await executor.query("delete from cc_model_pricing where tenant_id = $1 and id = $2", [tenantId, safeText(id)]);
    },
    async enabledPricingForProvider(providerId) {
      const result = await executor.query(
        `${PRICING_SELECT} where tenant_id = $1 and provider_id = $2 and enabled = true`,
        [tenantId, providerId]
      );
      return result.rows.map(fromRow);
    },
    async recordTaskCost(task) {
      const pricingList = await this.enabledPricingForProvider(task.providerId);
      const pricing = resolvePricingForTask(task, pricingList);
      const computation = computeTaskCost({ payload: task.payload, result: task.result, pricing });
      if (computation.billedSource === "unpriced" || computation.amount === 0) {
        // Still record unpriced successes so the admin summary can surface gaps.
        if (computation.billedSource !== "unpriced") return null;
      }
      const costId = `cost-${Date.now().toString(36)}-${task.id.slice(-6)}`;
      await executor.query(
        `insert into cc_task_cost_items (id, task_id, tenant_id, provider_id, model_record_id, run_target_id, pricing_id, pricing_kind, billed_source, quantity, unit_price, amount, currency)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (task_id) do update set amount = excluded.amount, billed_source = excluded.billed_source, unit_price = excluded.unit_price, quantity = excluded.quantity`,
        [
          costId,
          task.id,
          tenantId,
          task.providerId,
          task.modelRecordId || "",
          pricing?.runTargetId || "",
          pricing?.id || "",
          pricing?.kind || "",
          computation.billedSource,
          computation.quantity,
          computation.unitPrice,
          computation.amount,
          computation.currency
        ]
      );
      return { ...computation, costId };
    },
    async costSummary(options: { since?: number | undefined; until?: number | undefined; limit?: number | undefined } = {}) {
      const since = options.since ? new Date(options.since) : new Date(Date.now() - 30 * 24 * 3600_000);
      // JS Date is millisecond-precision while created_at stores microseconds;
      // widen the upper bound inclusively so same-millisecond rows are never dropped.
      const until = new Date((options.until ?? Date.now()) + 1);
      const rows = await executor.query(
        `select date_trunc('day', created_at) as day, provider_id, run_target_id, billed_source, currency,
                sum(amount) as amount, count(*) as tasks
         from cc_task_cost_items
         where tenant_id = $1 and created_at >= $2 and created_at <= $3
         group by 1, 2, 3, 4, 5
         order by 1 desc, 2, 3
         limit $4`,
        [tenantId, since, until, Math.max(1, Math.min(500, Number(options.limit) || 200))]
      );
      let total = 0;
      const currencies: Record<string, number> = {};
      const items = rows.rows.map((row) => {
        const amount = Number(row.amount ?? 0);
        total += amount;
        const currency = String(row.currency ?? "CNY");
        currencies[currency] = (currencies[currency] || 0) + amount;
        return {
          day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day ?? ""),
          providerId: String(row.provider_id ?? ""),
          runTargetId: String(row.run_target_id ?? ""),
          billedSource: String(row.billed_source ?? ""),
          currency,
          amount,
          tasks: Number(row.tasks ?? 0)
        };
      });
      return { since: since.toISOString(), until: until.toISOString(), items, totalAmount: Math.round(total * 1e6) / 1e6, byCurrency: currencies };
    }
  };
}

export interface PricingRepositoryShape {
  upsertPricing(pricing: PricingRecord): Promise<PricingRecord>;
  listPricing(providerId?: string): Promise<PricingRecord[]>;
  deletePricing(id: string): Promise<void>;
  enabledPricingForProvider(providerId: string): Promise<PricingRecord[]>;
  recordTaskCost(task: { id: string; providerId: string; modelRecordId?: string | undefined; payload: Record<string, unknown>; result: Record<string, unknown> }): Promise<(ReturnType<typeof computeTaskCost> & { costId: string }) | null>;
  costSummary(options?: { since?: number | undefined; until?: number | undefined; limit?: number | undefined }): Promise<Record<string, unknown>>;
}

export type { PricingScope };
