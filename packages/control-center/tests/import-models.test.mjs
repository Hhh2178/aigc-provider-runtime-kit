import test from "node:test";
import assert from "node:assert/strict";
import { importProviderModels } from "@aigc-kit/control-center/domain/import-models";
import {
  normalizeCapability,
  normalizeModelCapabilityTags,
  inferModelCapabilityTags,
  normalizeOptionalProtocol,
  normalizeAdminModelRecord,
  normalizeModelTestState,
  normalizeCatalogSortOrder,
  applyCatalogDisplayOrder,
  parseAdvancedConfig
} from "@aigc-kit/control-center/domain/model-normalize";
import { safeSlug, safeText } from "@aigc-kit/control-center/util";

const deps = {
  normalizeCapability,
  normalizeModelCapabilityTags,
  inferModelCapabilityTags,
  normalizeOptionalProtocol,
  normalizeAdminModelRecord,
  normalizeModelTestState,
  plainObject: parseAdvancedConfig,
  safeSlug,
  safeText
};

test("importProviderModels creates new records with inferred capability and slots", () => {
  const now = 1750000000000;
  const result = importProviderModels({
    providerId: "prov",
    now,
    existing: [],
    incoming: [
      { modelId: "seedance-2-pro", capability: "video" },
      { modelId: "mimo-tts", capability: "audio" }
    ],
    deps
  });

  assert.equal(result.imported, 2);
  const video = result.touchedModels.find((model) => model.modelId === "seedance-2-pro");
  assert.equal(video.capability, "video");
  assert.equal(video.capabilityTags.includes("video_generation"), true);
  assert.equal(video.inputProfile.includes("image_reference"), true);

  const audio = result.touchedModels.find((model) => model.modelId === "mimo-tts");
  assert.equal(audio.capability, "audio");
  assert.equal(audio.inputProfile.includes("audio_reference"), true);
});

test("importProviderModels keeps existing settings and reuses ids", () => {
  const now = 1750000000000;
  const existing = {
    id: "prov-video-seedance-2-pro",
    providerId: "prov",
    modelId: "seedance-2-pro",
    displayName: "自定义名字",
    capability: "video",
    enabled: false,
    inputProfile: "prompt,image_reference,first_frame",
    capabilityTags: ["video_generation", "audio_understanding"],
    testState: { chat: { ok: true, status: 200, message: "ok", checkedAt: now } },
    parameterSchema: "{}",
    createdAt: now - 1000,
    updatedAt: now - 1000
  };
  const result = importProviderModels({
    providerId: "prov",
    now,
    existing: [existing],
    incoming: [{ modelId: "seedance-2-pro" }],
    deps
  });

  assert.equal(result.imported, 1);
  const merged = result.touchedModels[0];
  assert.equal(merged.id, "prov-video-seedance-2-pro");
  assert.equal(merged.displayName, "seedance-2-pro"); // displayName 随导入覆盖（与源项目一致）
  assert.equal(merged.enabled, true); // 导入会重新启用模型（与源项目一致）
  assert.equal(merged.testState.chat.ok, true);
  assert.equal(merged.updatedAt, now);
});

test("normalizeAdminModelRecord coerces capability aliases and tags", () => {
  const normalized = normalizeAdminModelRecord({
    id: "m1",
    providerId: "p1",
    modelId: "gpt-5",
    displayName: "GPT-5",
    capability: "text",
    enabled: false,
    inputProfile: "",
    parameterSchema: "{ bad json ",
    createdAt: 1,
    updatedAt: 1
  });
  assert.equal(normalized.capability, "chat");
  assert.equal(normalized.capabilityTags.includes("text_chat"), true);
  assert.equal(normalized.parameterSchema, "{}");
  assert.equal(normalized.executionMode, "sync_inline");

  const video = normalizeAdminModelRecord({
    id: "m2",
    providerId: "p1",
    modelId: "wan2.5",
    displayName: "WAN",
    capability: "video",
    enabled: false,
    inputProfile: "",
    parameterSchema: "{}",
    createdAt: 1,
    updatedAt: 1
  });
  assert.equal(video.executionMode, "worker_queue");
  assert.equal(video.inputProfile.includes("first_frame") === false, true);
});

test("catalog display order helpers validate scope", () => {
  assert.throws(() => applyCatalogDisplayOrder(["a", "b"].map((id) => ({ id })), ["a"]), /SCOPE_MISMATCH/);
  assert.throws(() => applyCatalogDisplayOrder(["a", "b"].map((id) => ({ id })), ["a", "a"]), /SCOPE_MISMATCH/);
  const ordered = applyCatalogDisplayOrder(
    [{ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 0 }],
    ["b", "a"]
  );
  assert.equal(ordered.find((item) => item.id === "b").sortOrder, 0);
  assert.equal(ordered.find((item) => item.id === "a").sortOrder, 10);
  assert.equal(normalizeCatalogSortOrder("nan"), 0);
});
