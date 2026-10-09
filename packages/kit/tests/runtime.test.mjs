import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenAICompatibleAdapter,
  createProviderRegistry,
  createProviderRuntime,
  createRunningHubAdapter,
  isProviderRuntimeError,
  validateProviderExecutionInput
} from "aigc-provider-runtime-kit/runtime";

function registry(overrides = {}) {
  return createProviderRegistry({
    providers: [{ id: "provider-1", name: "Provider", baseUrl: "https://api.example.com/v1", protocol: "openai", enabled: true, ...overrides.provider }],
    models: [{
      id: "model-1",
      providerId: "provider-1",
      modelId: "upstream-model",
      displayName: "Model",
      capability: "image",
      enabled: true,
      parameterSchema: {
        prompt: { type: "string", required: true },
        size: { type: "select", options: ["small", "large"] },
        duration: { type: "number", min: 1, max: 10 },
        referenceImages: { type: "image[]", max: 2 }
      },
      ...overrides.model
    }]
  });
}

test("runtime validates, selects an adapter, normalizes identity, and emits events", async () => {
  const events = [];
  const runtime = createProviderRuntime({
    registry: registry(),
    createExecutionId: () => "execution-1",
    hooks: { onEvent: (event) => { events.push(event.type); } },
    adapters: [{
      id: "test-adapter",
      supports: () => true,
      execute: async (context) => ({
        status: "completed",
        providerId: "wrong",
        modelId: "wrong",
        capability: "chat",
        outputs: [{ type: "image", url: "https://example.com/result.png" }],
        raw: context.input
      })
    }]
  });

  const result = await runtime.execute({ providerId: "provider-1", modelId: "model-1", input: { prompt: "cat", size: "large" } });
  assert.equal(result.providerId, "provider-1");
  assert.equal(result.modelId, "model-1");
  assert.equal(result.capability, "image");
  assert.deepEqual(events, ["execution.started", "execution.validated", "adapter.selected", "execution.succeeded"]);
});

test("input validation reports required, option, range, and list limits", () => {
  const model = registry().getModel("model-1");
  const result = validateProviderExecutionInput(model, {
    size: "medium",
    duration: 20,
    referenceImages: ["a", "b", "c"],
    firstFrame: "https://example.com/first.png"
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((item) => item.code), ["required", "invalid", "out_of_range", "out_of_range", "unsupported"]);
});

test("runtime rejects disabled configuration and missing adapters", async () => {
  const disabled = createProviderRuntime({ registry: registry({ provider: { enabled: false } }), adapters: [] });
  await assert.rejects(disabled.execute({ providerId: "provider-1", modelId: "model-1", input: { prompt: "cat" } }), (error) => isProviderRuntimeError(error) && error.code === "PROVIDER_DISABLED");

  const noAdapter = createProviderRuntime({ registry: registry(), adapters: [] });
  await assert.rejects(noAdapter.execute({ providerId: "provider-1", modelId: "model-1", input: { prompt: "cat" } }), (error) => isProviderRuntimeError(error) && error.code === "ADAPTER_NOT_FOUND");
});

test("runtime timeout aborts adapter execution and hook failures are isolated", async () => {
  const hookErrors = [];
  const runtime = createProviderRuntime({
    registry: registry(),
    hooks: {
      onEvent: () => { throw new Error("logging unavailable"); },
      onHookError: (error) => { hookErrors.push(String(error?.message || error)); }
    },
    adapters: [{
      id: "slow",
      supports: () => true,
      execute: () => new Promise(() => {})
    }]
  });

  await assert.rejects(runtime.execute({ providerId: "provider-1", modelId: "model-1", input: { prompt: "cat" }, timeoutMs: 5 }), (error) => isProviderRuntimeError(error) && error.code === "EXECUTION_ABORTED");
  assert.ok(hookErrors[0] === "logging unavailable");
});

test("runtime surfaces unknown input fields as warnings and passes inputs through", async () => {
  let received;
  const runtime = createProviderRuntime({
    registry: registry({ model: { parameterSchema: { prompt: { type: "string", required: true } } } }),
    adapters: [{
      id: "echo",
      supports: () => true,
      execute: async (context) => {
        received = context.input;
        return { status: "completed", providerId: "provider-1", modelId: "model-1", capability: "image", outputs: [{ type: "text", text: "ok" }] };
      }
    }]
  });

  const result = await runtime.execute({ providerId: "provider-1", modelId: "model-1", input: { prompt: "cat", surprise: "value" } });
  assert.equal(received.surprise, "value");
  assert.ok(result.warnings.some((warning) => warning.includes('"surprise"')));
});

test("select options accept numeric values matching string options", () => {
  const model = registry().getModel("model-1");
  const result = validateProviderExecutionInput(model, { prompt: "cat", size: 2 });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.path === "input.size" && issue.code === "invalid"));

  const numericOptions = createProviderRegistry({
    providers: [{ id: "provider-1", name: "Provider", baseUrl: "https://api.example.com/v1", protocol: "openai", enabled: true }],
    models: [{
      id: "m",
      providerId: "provider-1",
      modelId: "upstream",
      displayName: "M",
      capability: "image",
      enabled: true,
      parameterSchema: { size: { type: "select", options: ["256", "512"] } }
    }]
  });
  const coerced = validateProviderExecutionInput(numericOptions.getModel("m"), { size: 256 });
  assert.equal(coerced.valid, true);
});

test("registry deep-freezes nested definitions without mutating caller objects", () => {
  const definition = {
    id: "provider-1",
    name: "Provider",
    baseUrl: "https://api.example.com/v1",
    protocol: "openai",
    enabled: true,
    advancedConfig: { nested: { allowed: true } }
  };
  const registryEntry = createProviderRegistry({ providers: [definition] }).listProviders()[0];

  assert.equal(Object.isFrozen(registryEntry), true);
  assert.equal(Object.isFrozen(registryEntry.advancedConfig), true);
  assert.equal(Object.isFrozen(registryEntry.advancedConfig.nested), true);
  // Caller objects stay mutable: the registry stored deep-frozen clones.
  assert.equal(Object.isFrozen(definition), false);
  assert.equal(Object.isFrozen(definition.advancedConfig.nested), false);
});

test("OpenAI-compatible adapter normalizes chat output and usage", async () => {
  const adapter = createOpenAICompatibleAdapter({
    client: {
      request: async () => ({}),
      createImage: async () => ({}),
      createChatCompletion: async (body) => ({ choices: [{ message: { content: `hello ${body.model}` } }], usage: { prompt_tokens: 2, completion_tokens: 3 } })
    }
  });
  const runtime = createProviderRuntime({
    registry: registry({ model: { capability: "chat", parameterSchema: { prompt: { type: "string", required: true } } } }),
    adapters: [adapter]
  });

  const result = await runtime.execute({ providerId: "provider-1", modelId: "model-1", input: { prompt: "hello" } });
  assert.equal(result.outputs[0].text, "hello upstream-model");
  assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
});

test("RunningHub adapter maps configured fields and emits progress", async () => {
  let received;
  const adapter = createRunningHubAdapter({
    client: {
      runTask: async (input) => {
        received = input;
        await input.onHeartbeat?.({ upstreamStatus: "RUNNING", progress: "45%" });
        return { adapter: "runninghub", upstreamTaskId: "task-1", rhTargetType: "workflow", rhRunTargetId: "workflow-1", raw: {}, imageUrls: [], videoUrls: ["https://example.com/video.mp4"], audioUrls: [] };
      }
    }
  });
  const events = [];
  const runtime = createProviderRuntime({
    registry: registry({
      provider: { protocol: "runninghub" },
      model: {
        capability: "video",
        advancedConfig: { runninghub: { targetType: "workflow", runTargetId: "workflow-1", workflowId: "workflow-1", fieldMap: { prompt: { nodeId: "6", fieldName: "prompt" } } } }
      }
    }),
    adapters: [adapter],
    hooks: { onEvent: (event) => { events.push(event); } }
  });

  const result = await runtime.execute({ providerId: "provider-1", modelId: "model-1", input: { prompt: "tropical city" } });
  assert.deepEqual(received.nodeInfoList, [{ nodeId: "6", fieldName: "prompt", fieldValue: "tropical city" }]);
  assert.equal(result.taskId, "task-1");
  assert.equal(result.outputs[0].type, "video");
  assert.equal(events.find((event) => event.type === "execution.progress").progress.percent, 45);
});
