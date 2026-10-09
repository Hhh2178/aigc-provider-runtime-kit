import { readJsonBody, sendJson, Router, HttpError } from "../http.js";
import type { ControlCenterConfig } from "../config.js";
import type { ControlCenterServices } from "../index.js";
import { normalizePricingInput, type PricingInput, type PricingScope } from "../domain/cost.js";
import { safeText } from "../util.js";

export function registerPricingRoutes(router: Router, deps: { config: ControlCenterConfig; services: ControlCenterServices }) {
  void deps.config;
  const { services } = deps;

  router.add("GET", "/api/admin/pricing", async ({ response, url }) => {
    const providerId = safeText(url.searchParams.get("providerId"));
    const pricing = await services.pricing.listPricing(providerId || undefined);
    sendJson(response, { pricing });
  });

  router.add("PUT", "/api/admin/pricing", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<PricingInput & { scope?: PricingScope }>(request);
    const record = normalizePricingInput({
      scope: body.scope,
      providerId: body.providerId,
      modelRecordId: body.modelRecordId,
      runTargetId: body.runTargetId,
      kind: body.kind,
      unitPrice: body.unitPrice,
      perSecondPrice: body.perSecondPrice,
      currency: body.currency,
      enabled: body.enabled
    });
    const saved = await services.pricing.upsertPricing(record);
    if (admin) {
      await services.appendAudit(admin, "pricing.upsert", "pricing", saved.id, `设置定价 ${saved.scope}/${saved.providerId} 单价=${saved.unitPrice}`, requestContext);
    }
    sendJson(response, saved);
  });

  router.add("DELETE", "/api/admin/pricing/:pricingId", async ({ params, response, admin, requestContext }) => {
    const pricingId = String(params.pricingId ?? "");
    await services.pricing.deletePricing(pricingId);
    if (admin) await services.appendAudit(admin, "pricing.delete", "pricing", pricingId, "删除定价", requestContext);
    sendJson(response, { deleted: true, id: pricingId });
  });

  router.add("GET", "/api/admin/costs/summary", async ({ url, response }) => {
    const since = Number(url.searchParams.get("since")) || undefined;
    const until = Number(url.searchParams.get("until")) || undefined;
    const limit = Number(url.searchParams.get("limit")) || undefined;
    if (since !== undefined && !Number.isFinite(since)) throw new HttpError(400, "since 必须是毫秒时间戳");
    const summary = await services.pricing.costSummary({ since, until, limit });
    sendJson(response, summary);
  });
}
