import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultParameterSchemaForModel,
  durationOptionsFromRange,
  parseModelParameterSchema,
  uiMetadataFromSchema
} from "aigc-provider-runtime-kit/core";

test("defaultParameterSchemaForModel returns OpenAI image defaults", () => {
  const schema = defaultParameterSchemaForModel("image", "gpt-image-2", "openai");

  assert.equal(schema.prompt?.required, true);
  assert.deepEqual(schema.aspectRatio?.options?.slice(0, 3), ["1:1", "16:9", "9:16"]);
  assert.equal(schema.size?.default, "1024x1024");
  assert.equal(schema.referenceImages?.max, 9);
});

test("parseModelParameterSchema accepts JSON strings and rejects invalid values", () => {
  assert.deepEqual(parseModelParameterSchema('{"size":{"default":"auto"}}'), {
    size: { default: "auto" }
  });
  assert.deepEqual(parseModelParameterSchema("not-json"), {});
  assert.deepEqual(parseModelParameterSchema(["wrong"]), {});
});

test("uiMetadataFromSchema normalizes video duration ranges", () => {
  const metadata = uiMetadataFromSchema({
    duration: { mode: "range", min: 2, max: 6, step: 2, default: 4 },
    resolution: { options: ["720p", "1080p"], default: "1080p" }
  }, "video");

  assert.equal(metadata.durationMode, "range");
  assert.deepEqual(metadata.durationOptions, [2, 4, 6]);
  assert.equal(metadata.defaultDuration, 4);
  assert.equal(metadata.defaultResolution, "1080p");
});

test("durationOptionsFromRange keeps default values inside sorted output", () => {
  assert.deepEqual(durationOptionsFromRange({ min: 1, max: 3, step: 1, default: 2 }), [1, 2, 3]);
  assert.deepEqual(durationOptionsFromRange({ min: 2, max: 4, step: 2, default: 3 }), [2, 3, 4]);
});
