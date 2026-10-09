import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultParameterSchemaForModel,
  durationOptionsFromRange,
  parseModelParameterSchema,
  parseInputCapabilities,
  buildProviderMultipartRequestBody,
  uiMetadataFromSchema
} from "aigc-provider-runtime-kit/core";

test("defaultParameterSchemaForModel returns OpenAI image defaults", () => {
  const schema = defaultParameterSchemaForModel("image", "gpt-image-2", "openai");

  assert.equal(schema.prompt?.required, true);
  assert.deepEqual(schema.aspectRatio?.options?.slice(0, 3), ["1:1", "16:9", "9:16"]);
  assert.equal(schema.size?.default, "1024x1024");
  assert.equal(schema.referenceImages?.max, 9);
});

test("video schemas expose reference image input capability", () => {
  const schema = defaultParameterSchemaForModel("video", "video-model", "custom");
  const capabilities = parseInputCapabilities({ parameterSchema: schema }, "video");

  assert.equal(capabilities.imageReference, true);
  assert.equal(capabilities.multiImage, false);
});

test("buildProviderMultipartRequestBody accepts data URLs and scalars", async () => {
  const form = await buildProviderMultipartRequestBody({
    prompt: "hello",
    count: 2,
    image: "data:image/png;base64,aGVsbG8="
  }, ["image"]);

  assert.equal(form.get("prompt"), "hello");
  assert.equal(form.get("count"), "2");
  const image = form.get("image");
  assert.equal(image instanceof File, true);
  assert.equal(image.type, "image/png");
  assert.equal(await image.text(), "hello");
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
