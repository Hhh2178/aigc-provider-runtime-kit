import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRunningHubGroups,
  normalizeRunningHubCatalogItem,
  normalizeRunningHubCatalogItems,
  normalizeRunningHubFieldDefinitions,
  parseRunningHubRef,
  toAdminRunningHubCatalogItem,
  runningHubCatalogId,
  assertRunningHubEntryCanBeEnabled,
  hasRunningHubExplicitEmptyNodeInfoList,
  createBlankRhCatalogEntry
} from "@aigc-kit/control-center/domain/runninghub/catalog";
import { createRunningHubCatalogService } from "@aigc-kit/control-center/domain/runninghub/service";

const tokenStub = (bytes) => "0000000000".slice(0, bytes * 2);

test("parseRunningHubRef accepts the documented URL shapes", () => {
  assert.deepEqual(parseRunningHubRef("https://www.runninghub.cn/call-api/api-detail/1978404642654670849?apiType=4"), { type: "app", id: "1978404642654670849" });
  assert.deepEqual(parseRunningHubRef("/openapi/v2/run/ai-app/123"), { type: "app", id: "123" });
  assert.deepEqual(parseRunningHubRef("/run/workflow/abc-9"), { type: "workflow", id: "abc-9" });
  assert.deepEqual(parseRunningHubRef("workflow-xyz"), { type: "workflow", id: "workflow-xyz" });
  assert.equal(parseRunningHubRef("nothing useful"), null);
});

test("group normalization dedupes ids and names and sorts", () => {
  const groups = normalizeRunningHubGroups(
    [
      { id: "g2", name: "B组", description: "描述", sortOrder: 5 },
      { id: "g1", name: "a组" },
      { id: "g2", name: "重复ID" },
      { id: "g3", name: "b组" }
    ],
    "prov1",
    1111
  );
  assert.deepEqual(groups.map((group) => group.id), ["g1", "g2"]); // "其他组" 与 "B组" 同名当前被去重了无影响方案
  assert.equal(groups[0].providerId, "prov1");
  assert.equal(groups[0].enabled, true);
});

test("entry normalization builds catalog identity and admin metadata", () => {
  const entry = {
    id: 424242424242,
    kind: "app",
    enabled: true,
    fields: [{ nodeId: "6", fieldName: "prompt", label: "提示词", required: true }]
  };
  const normalized = normalizeRunningHubCatalogItem(entry, "app");
  assert.equal(normalized.id, "424242424242");
  assert.equal(normalized.runTargetId, "424242424242");
  assert.equal(normalized.fields.length, 1);
  assert.equal(normalized.parameterSchema, "{}");

  const provider = { id: "prov1", name: "示例服务商", baseUrl: "https://rh.example.com", rhGroups: [] };
  const item = toAdminRunningHubCatalogItem(provider, normalized);
  assert.equal(item.catalogId, "prov1:app:424242424242");
  assert.equal(runningHubCatalogId("prov1", "app", "424242424242"), item.catalogId);
  assert.equal(item.execution.submit.submitMode, "ai-app");
  assert.equal(item.inputSlots[0].bindingTarget.path, "6.prompt");
  assert.deepEqual(item.outputSchema, []);
});

test("item lists are filtered by valid group ids when provided", () => {
  const list = normalizeRunningHubCatalogItems(
    [{ id: "w1", kind: "workflow" }, { id: "w2", kind: "workflow", groupId: "g1" }],
    "workflow",
    new Set(["g1"])
  );
  assert.deepEqual(list.map((item) => item.id), ["w1", "w2"]);
});

test("enable guard requires an input slot or explicit empty nodeInfoList", () => {
  assert.throws(() => assertRunningHubEntryCanBeEnabled({ enabled: true, kind: "workflow", title: "蓝图", fields: [] }), /仍缺少输入槽定义/);
  assert.equal(hasRunningHubExplicitEmptyNodeInfoList('{"nodeInfoList": []}'), true);
  assert.doesNotThrow(() => assertRunningHubEntryCanBeEnabled({ enabled: true, kind: "workflow", fields: [{ nodeId: "9", fieldName: "image" }], testPayload: "{}" }));
  assert.doesNotThrow(() => assertRunningHubEntryCanBeEnabled({ enabled: false, fields: [] }));
});

test("blank entry factory produces disabled drafts", () => {
  const draft = createBlankRhCatalogEntry("workflow", "新建工作流", tokenStub);
  assert.equal(draft.enabled, false);
  assert.equal(draft.workflowId, draft.id);
  assert.equal(draft.appId, "");
});

test("service level create/read/delete against a fake repository keeps catalog consistent", async () => {
  const providers = new Map();
  providers.set("rh1", {
    id: "rh1",
    name: "RH 供应商",
    baseUrl: "https://rh.example.com",
    protocol: "runninghub",
    rhApps: [],
    rhWorkflows: [],
    rhGroups: [],
    rhKeyPool: [],
    createdAt: 1,
    updatedAt: 1
  });
  const repository = {
    async findProviderRecordById(id) { return providers.get(id) || null; },
    async readProviderRecords() { return [...providers.values()]; },
    async updateProviderRhCatalog(id, transform) {
      const next = transform(providers.get(id));
      providers.set(id, next);
      return next;
    },
    async updateProviderRecord() { throw new Error("not used"); }
  };
  const service = createRunningHubCatalogService(repository, tokenStub);

  await service.createGroup({ providerId: "rh1", name: "默认组" });
  await service.createCatalogItem({
    providerId: "rh1",
    kind: "workflow",
    title: "视频合成",
    workflowId: "999",
    runTargetId: "999",
    enabled: true,
    fields: [{ nodeId: "10", fieldName: "video", required: true }]
  });

  const groups = await service.listGroups("rh1");
  assert.equal(groups.length, 1);

  const items = await service.listCatalogItems();
  assert.equal(items.length, 1);
  const created = items[0];
  assert.equal(created.catalogId, `rh1:workflow:${created.id}`);
  assert.equal(created.runTargetId, "999");

  await service.updateCatalogItem(created.catalogId, { title: "视频合成 v2", enabled: true });
  const updated = (await service.listCatalogItems())[0];
  assert.equal(updated.title, "视频合成 v2");

  const test = await service.testCatalogItem(created.catalogId, { [`${updated.inputSlots[0].key}`]: "in.mp4" });
  assert.equal(test.ok, true);

  const missing = await service.testCatalogItem(created.catalogId, {});
  assert.equal(missing.ok, false);

  await service.deleteCatalogItem(created.catalogId);
  assert.equal((await service.listCatalogItems()).length, 0);
});
