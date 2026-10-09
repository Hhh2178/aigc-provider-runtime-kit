/**
 * Cost ledger domain: pricing keys, resolution precedence, and the pure
 * amount computation shared by the worker (write) and admin summary (read).
 *
 * Fixes the production gap where RunningHub catalog tasks (no model record)
 * could never be priced: pricing scope `rh_target` keys on the catalog run
 * target id instead of a model record.
 */

export type PricingScope = "model" | "rh_target";
export type PricingKind = "per_request" | "per_second";

export interface PricingRecord {
  id: string;
  scope: PricingScope;
  providerId: string;
  modelRecordId: string;
  runTargetId: string;
  kind: PricingKind;
  unitPrice: number;
  perSecondPrice: number;
  currency: string;
  enabled: boolean;
  createdAt?: number | undefined;
  updatedAt?: number | undefined;
}

export interface PricingInput {
  scope: PricingScope;
  providerId: string;
  modelRecordId?: string | undefined;
  runTargetId?: string | undefined;
  kind?: PricingKind | undefined;
  unitPrice?: number | undefined;
  perSecondPrice?: number | undefined;
  currency?: string | undefined;
  enabled?: boolean | undefined;
}

export function normalizePricingInput(input: PricingInput): PricingRecord {
  const scope: PricingScope = input.scope === "rh_target" ? "rh_target" : "model";
  const providerId = String(input.providerId || "").trim();
  if (!providerId) throw new Error("定价需要 providerId");
  const modelRecordId = String(input.modelRecordId || "").trim();
  const runTargetId = String(input.runTargetId || "").trim();
  if (scope === "model" && !modelRecordId) throw new Error("模型定价需要 modelRecordId");
  if (scope === "rh_target" && !runTargetId) throw new Error("RH 目录定价需要 runTargetId");
  const kind: PricingKind = input.kind === "per_second" ? "per_second" : "per_request";
  const now = Date.now();
  return {
    id: pricingId(scope, providerId, modelRecordId, runTargetId),
    scope,
    providerId,
    modelRecordId: scope === "model" ? modelRecordId : "",
    runTargetId: scope === "rh_target" ? runTargetId : "",
    kind,
    unitPrice: money(input.unitPrice),
    perSecondPrice: money(input.perSecondPrice),
    currency: String(input.currency || "CNY").trim().slice(0, 8) || "CNY",
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now
  };
}

export function pricingId(scope: PricingScope, providerId: string, modelRecordId: string, runTargetId: string) {
  if (scope === "model") return `price:model:${providerId}:${modelRecordId}`;
  return `price:rh:${providerId}:${runTargetId}`;
}

/**
 * Pricing resolution precedence: exact model record first, then the RunningHub
 * catalog run target (fixes previously unpricable RH catalog tasks).
 */
export function resolvePricingForTask(task: {
  providerId: string;
  modelRecordId?: string | undefined;
  payload: Record<string, unknown>;
}, available: PricingRecord[]): PricingRecord | null {
  const enabled = available.filter((item) => item.enabled && item.providerId === task.providerId);
  const modelRecordId = String(task.modelRecordId || "");
  if (modelRecordId) {
    const modelPricing = enabled.find((item) => item.scope === "model" && item.modelRecordId === modelRecordId);
    if (modelPricing) return modelPricing;
  }
  const runninghub = (task.payload.runninghub ?? {}) as Record<string, unknown>;
  const runTargetId = String(runninghub.runTargetId || runninghub.catalogId || "");
  if (runTargetId) {
    const byTarget = enabled.find((item) => item.scope === "rh_target" && (item.runTargetId === runTargetId || item.runTargetId === String(runninghub.catalogId || "")));
    if (byTarget) return byTarget;
  }
  return null;
}

export interface TaskCostComputation {
  amount: number;
  quantity: number;
  unitPrice: number;
  billedSource: "per_request" | "per_second" | "provider_usage" | "unpriced";
  currency: string;
}

/**
 * Pure amount computation for a successful task. Failure results are not
 * charged (production parity). `providerUsage.consumeMoney` from RunningHub
 * standard-model results takes precedence when present, keeping upstream coin
 * consumption inside the ledger (production gap fixed).
 */
export function computeTaskCost(input: {
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  pricing: PricingRecord | null;
}): TaskCostComputation {
  const { payload, result, pricing } = input;
  const providerUsage = plainObject(result.providerUsage);
  const consumeMoney = Number(providerUsage.consumeMoney ?? providerUsage.thirdPartyConsumeMoney);
  if (Number.isFinite(consumeMoney) && consumeMoney > 0) {
    return {
      amount: roundMoney(consumeMoney),
      quantity: 1,
      unitPrice: roundMoney(consumeMoney),
      billedSource: "provider_usage",
      currency: pricing?.currency || "CNY"
    };
  }
  if (!pricing) {
    return { amount: 0, quantity: 0, unitPrice: 0, billedSource: "unpriced", currency: "CNY" };
  }
  const quantity = taskQuantity(payload);
  if (pricing.kind === "per_second") {
    const durationSeconds = Number(result.durationSeconds ?? payload.durationSeconds ?? 0);
    const amount = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? roundMoney(durationSeconds * pricing.perSecondPrice)
      : 0;
    return { amount, quantity, unitPrice: pricing.perSecondPrice, billedSource: "per_second", currency: pricing.currency };
  }
  const unit = pricing.unitPrice;
  return { amount: roundMoney(quantity * unit), quantity, unitPrice: unit, billedSource: "per_request", currency: pricing.currency };
}

function taskQuantity(payload: Record<string, unknown>) {
  const raw = Number(payload.generationCount ?? payload.n ?? 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.floor(raw));
}

function money(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return roundMoney(numeric);
}

export function roundMoney(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
