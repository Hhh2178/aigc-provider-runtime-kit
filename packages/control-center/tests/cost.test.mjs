import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePricingInput,
  pricingId,
  resolvePricingForTask,
  computeTaskCost
} from "@aigc-kit/control-center/domain/cost";

test("pricing input normalization validates scopes and ids", () => {
  const model = normalizePricingInput({ scope: "model", providerId: "prov", modelRecordId: "m1", unitPrice: 0.12 });
  assert.equal(model.id, "price:model:prov:m1");
  assert.equal(model.unitPrice, 0.12);
  assert.equal(model.kind, "per_request");
  assert.equal(model.currency, "CNY");

  const rh = normalizePricingInput({ scope: "rh_target", providerId: "rh", runTargetId: "999", kind: "per_second", perSecondPrice: 0.5, currency: "USD" });
  assert.equal(rh.id, "price:rh:rh:999");
  assert.equal(rh.kind, "per_second");
  assert.equal(rh.runTargetId, "999");
  assert.equal(rh.modelRecordId, "");

  assert.throws(() => normalizePricingInput({ scope: "model", providerId: "prov" }), /modelRecordId/);
  assert.throws(() => normalizePricingInput({ scope: "rh_target", providerId: "prov" }), /runTargetId/);
  assert.throws(() => normalizePricingInput({ scope: "model", providerId: "" }), /providerId/);
  assert.equal(normalizePricingInput({ scope: "model", providerId: "p", modelRecordId: "m", unitPrice: -5 }).unitPrice, 0);
  assert.equal(pricingId("rh_target", "p", "", "t"), "price:rh:p:t");
});

test("pricing resolution prefers model pricing then falls back to RH catalog target (unpriced fix)", () => {
  const modelPricing = normalizePricingInput({ scope: "model", providerId: "prov", modelRecordId: "m1", unitPrice: 1 });
  const rhPricing = normalizePricingInput({ scope: "rh_target", providerId: "rh", runTargetId: "999", unitPrice: 2 });
  const available = [modelPricing, rhPricing];

  const modelTask = resolvePricingForTask({ providerId: "prov", modelRecordId: "m1", payload: {} }, available);
  assert.equal(modelPricing.id, modelPricing.id);
  assert.equal(modelTask?.id, modelPricing.id);

  // The production gap: an RH catalog task has no model record.
  const rhTask = resolvePricingForTask(
    { providerId: "rh", modelRecordId: undefined, payload: { runninghub: { catalogId: "rh:workflow:999", runTargetId: "999" } } },
    available
  );
  assert.equal(rhTask?.id, rhPricing.id);

  const noPricing = resolvePricingForTask({ providerId: "other", payload: {} }, available);
  assert.equal(noPricing, null);

  const disabled = resolvePricingForTask(
    { providerId: "rh", payload: { runninghub: { runTargetId: "999" } } },
    [{ ...rhPricing, enabled: false }]
  );
  assert.equal(disabled, null, "disabled pricing must not charge");
});

test("task cost computation covers request, usage, seconds and unpriced paths", () => {
  const perRequest = normalizePricingInput({ scope: "model", providerId: "prov", modelRecordId: "m1", unitPrice: 0.5 });
  const quantity = computeTaskCost({ payload: { generationCount: 3 }, result: {}, pricing: perRequest });
  assert.equal(quantity.billedSource, "per_request");
  assert.equal(quantity.quantity, 3);
  assert.equal(quantity.amount, 1.5);

  const usage = computeTaskCost({
    payload: {},
    result: { providerUsage: { consumeMoney: "1.25" } },
    pricing: null
  });
  assert.equal(usage.billedSource, "provider_usage");
  assert.equal(usage.amount, 1.25, "upstream coin consumption takes precedence");

  const perSecond = normalizePricingInput({ scope: "rh_target", providerId: "rh", runTargetId: "999", kind: "per_second", perSecondPrice: 0.1 });
  const seconds = computeTaskCost({ payload: {}, result: { durationSeconds: 30 }, pricing: perSecond });
  assert.equal(seconds.billedSource, "per_second");
  assert.equal(seconds.amount, 3);

  const noDuration = computeTaskCost({ payload: {}, result: {}, pricing: perSecond });
  assert.equal(noDuration.amount, 0, "missing duration must not guess a charge");

  const unpriced = computeTaskCost({ payload: {}, result: {}, pricing: null });
  assert.equal(unpriced.billedSource, "unpriced");
  assert.equal(unpriced.amount, 0);
});
