import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenAICompatibleClient,
  createProviderRegistry,
  isOpenAICompatibleError,
  ProviderRegistryValidationError,
  validateProviderDefinition,
  withRetry
} from "aigc-provider-runtime-kit/core";

test("provider registry validates references and filters enabled entries", () => {
  const registry = createProviderRegistry({
    providers: [
      { id: "openai", name: "OpenAI", baseUrl: "https://api.example.com/v1", protocol: "openai", enabled: true },
      { id: "disabled", name: "Disabled", baseUrl: "https://disabled.example.com", protocol: "custom", enabled: false }
    ],
    models: [
      { id: "image-1", providerId: "openai", modelId: "image-1", displayName: "Image 1", capability: "image", enabled: true },
      { id: "chat-1", providerId: "openai", modelId: "chat-1", displayName: "Chat 1", capability: "chat", enabled: false }
    ]
  });

  assert.deepEqual(registry.listProviders({ enabledOnly: true }).map((item) => item.id), ["openai"]);
  assert.deepEqual(registry.listModels({ providerId: "openai", enabledOnly: true }).map((item) => item.id), ["image-1"]);
  assert.equal(registry.getModel("image-1")?.providerId, "openai");
});

test("provider registry reports invalid definitions and unknown providers", () => {
  assert.equal(validateProviderDefinition({ id: "x" }).valid, false);

  assert.throws(() => createProviderRegistry({
    providers: [{ id: "p", name: "P", baseUrl: "not-a-url", protocol: "unknown", enabled: true }],
    models: [{ id: "m", providerId: "missing", modelId: "m", displayName: "M", capability: "image", enabled: true }]
  }), (error) => {
    assert.equal(error instanceof ProviderRegistryValidationError, true);
    assert.equal(error.issues.some((item) => item.code === "unknown_provider"), true);
    return true;
  });
});

test("withRetry applies deterministic exponential delays", async () => {
  const delays = [];
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("temporary");
    return "ok";
  }, {
    maxAttempts: 3,
    baseDelayMs: 10,
    jitter: 0,
    wait: async (ms) => { delays.push(ms); }
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("OpenAI-compatible client retries retryable responses", async () => {
  const calls = [];
  const client = createOpenAICompatibleClient({
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    retry: { maxAttempts: 2, baseDelayMs: 0, jitter: 0 },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return Response.json({ error: { message: "slow down" } }, { status: 429 });
      return Response.json({ id: "completion-1", choices: [] }, { headers: { "x-request-id": "req-1" } });
    }
  });

  const result = await client.createChatCompletion({ model: "chat-model", messages: [] });
  assert.equal(result.id, "completion-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret");
});

test("OpenAI-compatible client does not retry invalid requests", async () => {
  let calls = 0;
  const client = createOpenAICompatibleClient({
    baseUrl: "https://api.example.com/v1",
    retry: { maxAttempts: 3, baseDelayMs: 0 },
    fetcher: async () => {
      calls += 1;
      return Response.json({ error: { message: "bad request" } }, { status: 400 });
    }
  });

  await assert.rejects(client.createImage({ prompt: "cat" }), (error) => {
    return isOpenAICompatibleError(error) && error.status === 400 && error.retryable === false;
  });
  assert.equal(calls, 1);
});
