import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRunningHubExecutionDescriptor,
  createRunningHubClient,
  extractRunningHubOutputUrls,
  isRunningHubError,
  normalizeRunningHubInputSlots,
  orderRunningHubKeys,
  acquireRunningHubKey,
  releaseRunningHubKey
} from "aigc-provider-runtime-kit/runninghub";

test("buildRunningHubExecutionDescriptor creates app submit metadata", () => {
  const descriptor = buildRunningHubExecutionDescriptor({
    kind: "app",
    appId: "app-123",
    taskCapability: "image"
  });

  assert.equal(descriptor.submit.targetType, "app");
  assert.equal(descriptor.submit.targetId, "app-123");
  assert.equal(descriptor.submit.submitMode, "ai-app");
  assert.equal(descriptor.submit.taskCapability, "image");
});

test("createRunningHubClient submits and polls a workflow", async () => {
  const calls = [];
  const responses = [
    { code: 0, data: { taskId: "task-1" } },
    { code: 0, status: "SUCCESS", data: { fileUrl: "https://example.com/result.mp4" } }
  ];
  const client = createRunningHubClient({
    apiKey: "test-key",
    baseUrl: "https://www.runninghub.cn",
    wait: async () => {},
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(responses.shift());
    }
  });

  const result = await client.runTask({
    targetType: "workflow",
    runTargetId: "workflow-1",
    nodeInfoList: []
  });

  assert.equal(result.upstreamTaskId, "task-1");
  assert.deepEqual(result.videoUrls, ["https://example.com/result.mp4"]);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /workflow\/workflow-1$/);
  assert.equal(JSON.parse(calls[0].init.body).apiKey, "test-key");
});

test("createRunningHubClient rejects unknown terminal states", async () => {
  const responses = [
    { code: 0, data: { taskId: "task-2" } },
    { code: 0, status: "MYSTERY", data: {} }
  ];
  const client = createRunningHubClient({
    apiKey: "test-key",
    baseUrl: "https://www.runninghub.cn",
    wait: async () => {},
    fetcher: async () => Response.json(responses.shift())
  });

  await assert.rejects(
    client.runTask({ targetType: "workflow", runTargetId: "workflow-1", nodeInfoList: [] }),
    (error) => isRunningHubError(error) && error.code === "UNKNOWN_TASK_STATUS"
  );
});

test("createRunningHubClient supports cancellation", async () => {
  const controller = new AbortController();
  controller.abort("stop");
  const client = createRunningHubClient({
    apiKey: "test-key",
    baseUrl: "https://www.runninghub.cn",
    fetcher: async () => { throw new Error("fetch should not run"); }
  });

  await assert.rejects(
    client.runTask({ targetType: "workflow", runTargetId: "workflow-1", nodeInfoList: [], signal: controller.signal }),
    (error) => isRunningHubError(error) && error.code === "REQUEST_ABORTED"
  );
});

test("key pool applies a configurable lease and releases the key", async () => {
  const values = new Map();
  const expirations = [];
  const runtime = {
    async get(key) { return values.has(key) ? String(values.get(key)) : null; },
    async incr(key) { const next = (values.get(key) || 0) + 1; values.set(key, next); return next; },
    async decr(key) { const next = (values.get(key) || 0) - 1; values.set(key, next); return next; },
    async del(key) { values.delete(key); },
    async expire(key, seconds) { expirations.push({ key, seconds }); }
  };
  const input = {
    providerId: "runninghub",
    defaultConcurrency: 1,
    leaseSeconds: 120,
    runtime,
    keys: [{ id: "key-1", note: "", apiKey: "secret", maxConcurrency: 1, enabled: true, isDefault: true }]
  };

  const acquired = await acquireRunningHubKey(input);
  assert.equal(acquired.acquired, true);
  assert.equal(expirations[0].seconds, 120);
  assert.equal((await acquireRunningHubKey(input)).reason, "all_keys_busy");

  await releaseRunningHubKey({ providerId: "runninghub", keyId: "key-1", runtime });
  assert.equal((await acquireRunningHubKey(input)).acquired, true);
});

test("buildRunningHubExecutionDescriptor creates workflow submit metadata", () => {
  const descriptor = buildRunningHubExecutionDescriptor({
    kind: "workflow",
    workflowId: "workflow-123",
    taskCapability: "video"
  });

  assert.equal(descriptor.submit.targetType, "workflow");
  assert.equal(descriptor.submit.targetId, "workflow-123");
  assert.equal(descriptor.submit.queryMode, "openapi-v2-query");
});

test("normalizeRunningHubInputSlots maps field definitions to reusable slots", () => {
  const slots = normalizeRunningHubInputSlots([
    {
      nodeId: "6",
      fieldName: "image",
      label: "Reference Image",
      valueType: "image",
      required: true
    },
    {
      nodeId: "7",
      fieldName: "prompt",
      valueType: "string",
      defaultValue: "a cat"
    },
    {
      nodeId: "",
      fieldName: "ignored"
    }
  ]);

  assert.equal(slots.length, 2);
  assert.equal(slots[0].dataType, "image");
  assert.equal(slots[0].supportsUpload, true);
  assert.equal(slots[1].supportsManualInput, true);
  assert.equal(slots[1].defaultValue, "a cat");
});

test("orderRunningHubKeys prioritizes preferred, default, then enabled keys", () => {
  const ordered = orderRunningHubKeys([
    { id: "disabled", note: "", apiKey: "x", maxConcurrency: 1, enabled: false, isDefault: true },
    { id: "default", note: "", apiKey: "x", maxConcurrency: 1, enabled: true, isDefault: true },
    { id: "preferred", note: "", apiKey: "x", maxConcurrency: 1, enabled: true, isDefault: false },
    { id: "no-key", note: "", maxConcurrency: 1, enabled: true, isDefault: false }
  ], "preferred");

  assert.deepEqual(ordered.map((item) => item.id), ["preferred", "default"]);
});

test("extractRunningHubOutputUrls classifies nested output URLs", () => {
  const result = extractRunningHubOutputUrls({
    data: {
      files: [
        { fileUrl: "https://example.com/a.png" },
        { url: "https://example.com/b.mp4?download=1" },
        { previewUrl: "https://example.com/c.wav" }
      ]
    }
  });

  assert.deepEqual(result.imageUrls, ["https://example.com/a.png"]);
  assert.deepEqual(result.videoUrls, ["https://example.com/b.mp4?download=1"]);
  assert.deepEqual(result.audioUrls, ["https://example.com/c.wav"]);
});
