import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCapability,
  normalizeProviderProtocol,
  providerModelsUrl,
  providerModelHeaders,
  classifyUpstreamModel,
  inferModelCapabilityTags,
  parseUpstreamModels
} from "@aigc-kit/control-center/domain/protocol-catalog";

test("providerModelsUrl builds protocol-specific model list endpoints", () => {
  assert.equal(providerModelsUrl("https://api.example.com/v1", "openai"), "https://api.example.com/v1/models");
  assert.equal(providerModelsUrl("https://api.example.com/", "openai"), "https://api.example.com/v1/models");
  assert.equal(providerModelsUrl("https://gen.example.com", "gemini"), "https://gen.example.com/v1beta/models");
  assert.equal(providerModelsUrl("https://ark.example.com", "volcengine"), "https://ark.example.com/api/v3/models");
  assert.equal(providerModelsUrl("https://rh.example.com", "runninghub"), "https://rh.example.com/openapi/v2/models");
  assert.equal(providerModelsUrl("https://grsai.example.com", "grsai_draw"), "");
});

test("providerModelHeaders adapt per protocol auth style", () => {
  assert.deepEqual(providerModelHeaders("Bearer abc", "gemini"), { "x-goog-api-key": "Bearer abc", accept: "application/json" });
  assert.deepEqual(providerModelHeaders("Bearer abc", "runninghub"), { authorization: "abc", accept: "application/json" });
  assert.deepEqual(providerModelHeaders("abc", "openai"), { authorization: "Bearer abc", accept: "application/json" });
});

test("protocol aliases and capability aliases normalize", () => {
  assert.equal(normalizeProviderProtocol("AICOPY"), "aicopy");
  assert.equal(normalizeProviderProtocol("gpt-like"), "openai");
  assert.equal(normalizeCapability("text"), "chat");
  assert.equal(normalizeCapability("llm"), "chat");
  assert.equal(normalizeCapability("tts"), "audio");
  assert.equal(normalizeCapability("banana-plugin"), "image");
});

test("classifyUpstreamModel buckets ids into capabilities", () => {
  assert.equal(classifyUpstreamModel("gpt-5-chat"), "chat");
  assert.equal(classifyUpstreamModel("seedance-lite"), "video");
  assert.equal(classifyUpstreamModel("flux-pro-1.1"), "image");
  assert.equal(classifyUpstreamModel("mimo-v2.5-tts"), "audio");
});

test("capability tags infer understanding/reasoning/clone signals", () => {
  const tags = inferModelCapabilityTags("qwen3-vl-thinking", "chat").sort();
  assert.ok(tags.includes("text_chat"));
  assert.ok(tags.includes("image_understanding"));
  assert.ok(tags.includes("video_understanding"));
  assert.ok(tags.includes("reasoning"));
  assert.ok(inferModelCapabilityTags("cosyvoice-clone-v3", "audio").includes("voice_clone"));
  assert.ok(inferModelCapabilityTags("suno-v5", "audio").includes("music_generation"));
});

test("parseUpstreamModels handles data/models/list arrays and gemini prefix", () => {
  const parsed = parseUpstreamModels({ data: [{ id: "gpt-image-2" }, { id: "gemini-2.5-pro" }] }, "openai");
  assert.equal(parsed.total, 2);
  assert.deepEqual(parsed.imageModels, ["gpt-image-2"]);

  const gemini = parseUpstreamModels({ models: ["models/gemini-2.5-flash"], missing: true }, "gemini");
  assert.deepEqual(gemini.all, ["gemini-2.5-flash"]);

  const empty = parseUpstreamModels(" garbage ", "openai");
  assert.equal(empty.total, 0);
});
