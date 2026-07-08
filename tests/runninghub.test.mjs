import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRunningHubExecutionDescriptor,
  extractRunningHubOutputUrls,
  normalizeRunningHubInputSlots,
  orderRunningHubKeys
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
