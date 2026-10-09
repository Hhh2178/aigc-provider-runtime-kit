import test from "node:test";
import assert from "node:assert/strict";
import { resolveTaskSubmit } from "@aigc-kit/control-center/domain/task-submit";

function provider(overrides = {}) {
  return {
    id: "prov",
    name: "示例",
    baseUrl: "https://api.example.com/v1",
    protocol: "openai",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function model(overrides = {}) {
  return {
    id: "prov-image-flux",
    providerId: "prov",
    modelId: "flux-pro",
    displayName: "FLUX",
    capability: "image",
    enabled: true,
    inputProfile: "prompt,image_reference",
    parameterSchema: "{\"prompt\":{\"type\":\"string\",\"required\":true},\"size\":{\"type\":\"select\",\"options\":[\"1024x1024\"]}}",
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function deps(providerRecord, modelRecord) {
  return {
    findProviderRecordById: async () => providerRecord ?? null,
    findModelRecordById: async () => modelRecord ?? null,
    findEnabledEnabledModel: async () => providerRecord && modelRecord ? { provider: providerRecord, model: modelRecord } : null
  };
}

test("runninghub submissions require catalogId and map input slots", async () => {
  const rhProvider = provider({
    protocol: "runninghub",
    baseUrl: "https://rh.example.com",
    rhApps: [],
    rhWorkflows: [{
      id: "999",
      kind: "workflow",
      title: "视频合成",
      enabled: true,
      taskCapability: "video",
      fields: [
        { nodeId: "10", fieldName: "video", required: true },
        { nodeId: "12", fieldName: "fps", defaultValue: 24, required: true }
      ]
    }]
  });

  await assert.rejects(
    resolveTaskSubmit({ capability: "video", body: { providerId: "prov", runninghub: {} } }, deps(rhProvider, null))
      .then(() => {}) ?? Promise.resolve(),
    /catalogId/
  );

  const resolved = await resolveTaskSubmit({
    capability: "video",
    body: {
      providerId: "prov",
      idempotencyKey: "once-a",
      runninghub: { catalogId: "prov:workflow:999", input: { "10:video": "in.mp4" } }
    }
  }, deps(rhProvider, null));

  assert.equal(resolved.protocol, "runninghub");
  assert.equal(resolved.payload.idempotencyKey, "once-a");
  const rh = resolved.payload.runninghub;
  assert.equal(rh.runTargetId, "999");
  assert.equal(rh.submitMode, "openapi-v2-workflow");
  assert.deepEqual(
    rh.nodeInfoList,
    [
      { nodeId: "10", fieldName: "video", fieldValue: "in.mp4" },
      { nodeId: "12", fieldName: "fps", fieldValue: 24 }
    ]
  );

  await assert.rejects(
    resolveTaskSubmit({ capability: "video", body: { providerId: "prov", runninghub: { catalogId: "prov:workflow:999", input: {} } } }, deps(rhProvider, null)),
    /缺少必填输入槽/
  );
});

test("openai image submissions validate model capability reuse and schema", async () => {
  const resolved = await resolveTaskSubmit({
    capability: "image",
    body: { modelRecordId: "prov-image-flux", input: { prompt: "cat", size: "1024x1024" } }
  }, deps(provider(), model()));
  assert.equal(resolved.provider.id, "prov");
  assert.equal(resolved.payload.prompt, "cat");
  assert.equal(resolved.payload.protocol, "openai");
  assert.equal(resolved.payload.timeoutMs, 15 * 60_000);
  const payloadInput = resolved.payload.input;
  assert.equal(payloadInput.prompt, "cat");

  await assert.rejects(
    resolveTaskSubmit({ capability: "image", body: { modelRecordId: "prov-image-flux", input: { prompt: "" } } }, deps(provider(), model())),
    /prompt is required/
  );

  await assert.rejects(
    resolveTaskSubmit({ capability: "image", body: { modelRecordId: "prov-image-flux", input: { prompt: "cat", size: "8000x8000" } } }, deps(provider(), model())),
    /任务参数校验失败/
  );

  await assert.rejects(
    resolveTaskSubmit({ capability: "chat", body: { modelRecordId: "prov-image-flux", input: { prompt: "hi" } } }, deps(provider(), model())),
    /与任务类型 chat 不匹配/
  );

  const unported = model({ protocolOverride: "aicopy" });
  await assert.rejects(
    resolveTaskSubmit({ capability: "video", body: { modelRecordId: "prov-image-flux", input: { prompt: "x" } } }, deps(provider(), unported)),
    /尚未移植/
  );

  const disabled = model({ enabled: false });
  await assert.rejects(
    resolveTaskSubmit({ capability: "image", body: { modelRecordId: "prov-image-flux", input: { prompt: "cat" } } }, deps(provider(), disabled)),
    /模型未启用/
  );

  await assert.rejects(
    resolveTaskSubmit({ capability: "image", body: { modelRecordId: "missing", input: {} } }, deps(provider(), null)),
    /模型记录不存在/
  );

  await assert.rejects(
    resolveTaskSubmit({ capability: "image", body: { input: {} } }, deps(provider(), model())),
    /缺少 providerId\+modelId 或 modelRecordId/
  );
});
