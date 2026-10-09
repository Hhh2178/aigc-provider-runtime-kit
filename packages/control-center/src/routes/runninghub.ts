import { readJsonBody, sendJson, Router } from "../http.js";
import type { ControlCenterServices } from "../index.js";
import type { ControlCenterConfig } from "../config.js";
import type { RhAnalyzeDraft } from "../domain/runninghub/analyze.js";
import { analyzeRunningHubCatalogDraft } from "../domain/runninghub/analyze.js";
import type { RhCatalogMutationBody, RhGroupMutationBody } from "../domain/runninghub/service.js";
import type { RhAdminCatalogItem, RhCatalogGroup, RhExecutionRules, RhOutputDefinition } from "../domain/runninghub/catalog.js";
import { safeText } from "../util.js";

export type RunningHubRoutesBody = RhCatalogMutationBody & { testPayloadLike?: unknown };

export function registerRunningHubAdminRoutes(router: Router, deps: { config: ControlCenterConfig; services: ControlCenterServices }) {
  const { services } = deps;

  router.add("GET", "/api/admin/runninghub/items", async ({ response, admin, requestContext }) => {
    const items = await services.runningHub.listCatalogItems();
    logAudit(admin, "runninghub.catalog.read", "runninghub", "catalog-items", "查看 RunningHub 条目目录", requestContext);
    sendJson(response, { items });
  });

  router.add("GET", "/api/admin/runninghub/groups", async ({ request, response, url }) => {
    void request;
    const providerId = safeText(url.searchParams.get("providerId"));
    sendJson(response, await services.runningHub.listGroups(providerId));
  });

  router.add("POST", "/api/admin/runninghub/groups", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<RhGroupMutationBody>(request);
    const group = await services.runningHub.createGroup(body);
    logAudit(admin, "runninghub.group.create", "runninghub-group", group.id, `创建 RunningHub 分组 ${group.name}`, requestContext);
    sendJson(response, group, 201);
  });

  router.add("PATCH", "/api/admin/runninghub/groups/:groupId", async ({ request, response, params, admin, requestContext }) => {
    const body = await readJsonBody<RhGroupMutationBody>(request);
    const group = await services.runningHub.updateGroup(String(params.groupId ?? ""), body);
    logAudit(admin, "runninghub.group.update", "runninghub-group", group.id, `更新 RunningHub 分组 ${group.name}`, requestContext);
    sendJson(response, group);
  });

  router.add("DELETE", "/api/admin/runninghub/groups/:groupId", async ({ response, params, admin, requestContext }) => {
    const result = await services.runningHub.deleteGroup(String(params.groupId ?? ""));
    logAudit(admin, "runninghub.group.delete", "runninghub-group", String(params.groupId ?? ""), `删除 RunningHub 分组，${result.ungroupedCatalogIds.length} 个条目移至未分组`, requestContext);
    sendJson(response, result);
  });

  router.add("POST", "/api/admin/runninghub/items", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<RhCatalogMutationBody>(request);
    const created = await services.runningHub.createCatalogItem(body);
    logAudit(admin, "runninghub.item.create", "runninghub", created.catalogId, `新建 RunningHub 条目 ${created.title}`, requestContext);
    sendJson(response, created, 201);
  });

  router.add("PATCH", "/api/admin/runninghub/items/:catalogId", async ({ request, response, params, admin, requestContext }) => {
    const body = await readJsonBody<RhCatalogMutationBody>(request);
    const updated = await services.runningHub.updateCatalogItem(String(params.catalogId ?? ""), body);
    logAudit(admin, "runninghub.item.update", "runninghub", updated.catalogId, `更新 RunningHub 条目 ${updated.title}`, requestContext);
    sendJson(response, updated);
  });

  router.add("DELETE", "/api/admin/runninghub/items/:catalogId", async ({ response, params, admin, requestContext }) => {
    const deleted = await services.runningHub.deleteCatalogItem(String(params.catalogId ?? ""));
    logAudit(admin, "runninghub.item.delete", "runninghub", deleted.catalogId, `删除 RunningHub 条目 ${deleted.title}`, requestContext);
    sendJson(response, { deleted: true, catalogId: deleted.catalogId });
  });

  router.add("POST", "/api/admin/runninghub/items/:catalogId/test", async ({ request, response, params, admin, requestContext }) => {
    const body = await readJsonBody<{ testPayload?: unknown }>(request);
    const result = await services.runningHub.testCatalogItem(String(params.catalogId ?? ""), body.testPayload);
    logAudit(admin, "runninghub.item.test", "runninghub", String(params.catalogId ?? ""), `测试 RunningHub 条目 ${String(params.catalogId ?? "")}: ${result.ok ? "ok" : "error"}`, requestContext);
    sendJson(response, result);
  });

  router.add("POST", "/api/admin/runninghub/analyze", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<{
      providerId?: string;
      kind?: "app" | "workflow";
      sourceUrl?: string;
      pageId?: string;
      runTargetId?: string;
      docUrl?: string;
      requestExample?: string;
      responseExample?: string;
      notes?: string;
    }>(request);
    const draft: RhAnalyzeDraft = analyzeRunningHubCatalogDraft(body);
    logAudit(
      admin,
      "runninghub.item.analyze",
      "runninghub",
      safeText(body.providerId || "runninghub"),
      `分析 RunningHub ${safeText(body.kind || "workflow")} 条目草案`,
      requestContext
    );
    sendJson(response, draft);
  });

  function logAudit(
    admin: Parameters<typeof services.appendAudit>[0] | undefined,
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
    requestContext: Parameters<typeof services.appendAudit>[5],
  ) {
    void admin; void action; void targetType; void targetId; void summary; void requestContext;
    if (!admin) return Promise.resolve();
    return services.appendAudit(admin, action, targetType, targetId, summary, requestContext);
  }
}

export type { RhAdminCatalogItem, RhCatalogGroup, RhExecutionRules, RhOutputDefinition };
