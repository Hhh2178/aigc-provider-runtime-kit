import test from "node:test";
import assert from "node:assert/strict";
import { executeTask } from "@aigc-kit/control-center/worker/execute";
import { createSecretCodec } from "@aigc-kit/control-center/crypto";

// Every case below runs against a fake upstream fetcher — no real provider is
// ever contacted. This is the primary dispatch verification for the 9
// production protocols.

const codec = createSecretCodec("dispatch-test-secret");

function makeTask(payload, overrides = {}) {
  return {
    id: `task-${payload.protocol ?? "x"}`,
    capability: payload.capability ?? "image",
    status: "running",
    providerId: "prov",
    modelRecordId: overrides.modelRecordId ?? "prov-model-1",
    protocol: "",
    claimedBy: "w1",
    attempts: 1,
    payload,
    result: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function providerView(overrides = {}) {
  return {
    id: "prov",
    protocol: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKeyPlain: "sk-test",
    rhKeyPool: [],
    ...overrides
  };
}

function model(overrides = {}) {
  return { id: "prov-model-1", modelId: "upstream-model", capability: "image", ...overrides };
}

function json(body, status = 200) {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  return {
    ok: status < 400,
    status,
    text: async () => text,
    arrayBuffer: async () => bytes.buffer,
    headers: { get: (name) => name.toLowerCase() === "content-length" ? String(bytes.byteLength) : "application/json" }
  };
}

test("openai family: chat, image, video and audio all normalize outputs", async () => {
  const chat = await executeTask({
    task: makeTask({ protocol: "openai", capability: "chat", prompt: "hi", input: {} }),
    provider: providerView(),
    model: model({ capability: "chat" }),
    fetcher: async (url) => {
      assert.ok(String(url).includes("/chat/completions"));
      return json({ choices: [{ message: { content: "你好" } }], usage: { prompt_tokens: 1, completion_tokens: 2 } });
    }
  }, codec);
  assert.equal(chat.status, "succeeded");
  assert.equal(chat.result.text, "你好");

  const image = await executeTask({
    task: makeTask({ protocol: "openai", capability: "image", prompt: "cat", input: { size: "1024x1024" } }),
    provider: providerView(),
    model: model(),
    fetcher: async (url) => {
      assert.ok(String(url).includes("/images/generations"));
      return json({ data: [{ url: "https://cdn.example.com/i.png" }, { b64_json: "QUJD" }] });
    }
  }, codec);
  assert.equal(image.status, "succeeded");
  assert.equal(image.result.imageUrls.length, 2);
  assert.ok(image.result.imageUrls[1].startsWith("data:image/png;base64,"));

  const video = await executeTask({
    task: makeTask({ protocol: "openai", capability: "video", prompt: "run", input: {} }),
    provider: providerView(),
    model: model({ capability: "video" }),
    fetcher: async (url) => {
      assert.ok(String(url).includes("/videos/generations"));
      return json({ data: { url: "https://cdn.example.com/v.mp4" } });
    }
  }, codec);
  assert.equal(video.status, "succeeded");
  assert.deepEqual(video.result.videoUrls, ["https://cdn.example.com/v.mp4"]);

  const audio = await executeTask({
    task: makeTask({ protocol: "openai", capability: "audio", prompt: "播报", input: {} }),
    provider: providerView(),
    model: model({ capability: "audio" }),
    fetcher: async () => json({ choices: [{ message: { content: "done", audio: { data: "data:audio/wav;base64,AAAA" } } }] })
  }, codec);
  assert.equal(audio.status, "succeeded");
  assert.deepEqual(audio.result.audioUrls, ["data:audio/wav;base64,AAAA"]);
});

test("volcengine rides the generic openai-style video path (production parity)", async () => {
  const result = await executeTask({
    task: makeTask({ protocol: "volcengine", capability: "video", prompt: "seedance", input: {} }),
    provider: providerView({ protocol: "volcengine", baseUrl: "https://ark.example.com/api/v3" }),
    model: model({ capability: "video" }),
    fetcher: async () => json({ data: { url: "https://cdn.example.com/seedance.mp4" } })
  }, codec);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.result.videoUrls, ["https://cdn.example.com/seedance.mp4"]);
});

test("apimart image and video flow through async task polling", async () => {
  let imageCalls = 0;
  const image = await executeTask({
    task: makeTask({ protocol: "apimart", capability: "image", prompt: "poster", input: {} }),
    provider: providerView({ protocol: "apimart" }),
    model: model(),
    fetcher: async (url) => {
      imageCalls += 1;
      if (String(url).includes("/images/generations")) return json({ data: [{ task_id: "img-1", status: "queued" }] });
      assert.ok(String(url).includes("/tasks/img-1"));
      return json({ data: { status: "completed", results: [{ url: "https://cdn.example.com/apimart.png" }] } });
    }
  }, codec);
  assert.equal(image.status, "succeeded");
  assert.deepEqual(image.result.imageUrls, ["https://cdn.example.com/apimart.png"]);
  assert.equal(imageCalls, 2);

  const video = await executeTask({
    task: makeTask({ protocol: "apimart", capability: "video", prompt: "clip", input: { aspectRatio: "16:9", duration: 5 } }),
    provider: providerView({ protocol: "apimart" }),
    model: model({ capability: "video" }),
    fetcher: async (url) => {
      if (String(url).includes("/videos/generations")) return json({ data: [{ task_id: "vid-7" }] });
      assert.ok(String(url).includes("/tasks/vid-7"));
      return json({ data: { status: "completed", result: { videos: ["https://cdn.example.com/apimart.mp4"] } } });
    }
  }, codec);
  assert.equal(video.status, "succeeded");
  assert.deepEqual(video.result.videoUrls, ["https://cdn.example.com/apimart.mp4"]);
  assert.equal(video.result.adapter, "apimart-video");
});

test("modelscope image uses async submit/poll headers", async () => {
  const seen = [];
  const result = await executeTask({
    task: makeTask({ protocol: "modelscope", capability: "image", prompt: "art", input: {} }),
    provider: providerView({ protocol: "modelscope" }),
    model: model(),
    fetcher: async (url, init) => {
      seen.push({ url: String(url), headers: init.headers });
      if (String(url).includes("/images/generations")) return json({ task_id: "ms-1", task_status: "RUNNING" });
      assert.ok(init.headers["X-ModelScope-Task-Type"] === "image_generation");
      return json({ task_status: "success", data: [{ url: "https://cdn.example.com/ms.png" }] });
    }
  }, codec);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.result.imageUrls, ["https://cdn.example.com/ms.png"]);
  assert.equal(seen[0].headers["X-ModelScope-Async-Mode"], "true");
});

test("grsai_draw image returns urls from the draw endpoint", async () => {
  const result = await executeTask({
    task: makeTask({ protocol: "grsai_draw", capability: "image", prompt: "paint", input: {} }),
    provider: providerView({ protocol: "grsai_draw", baseUrl: "https://grsai.example.com" }),
    model: model(),
    fetcher: async (url) => {
      assert.ok(String(url).includes("/v1/draw/completions"));
      return json({ code: 0, data: { results: [{ url: "https://cdn.example.com/grsai.png" }] } });
    }
  }, codec);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.result.imageUrls, ["https://cdn.example.com/grsai.png"]);
  assert.equal(result.result.adapter, "grsai-image");
});

test("aicopy video runs the contract payload and polls to completion", async () => {
  const result = await executeTask({
    task: makeTask({ protocol: "aicopy", capability: "video", prompt: "cinema", input: { aspectRatio: "16:9", duration: 6 } }),
    provider: providerView({ protocol: "aicopy" }),
    model: model({
      capability: "video",
      advancedConfig: { requestContractEnabled: true, requestContract: { bindings: [{ path: "metadata.ratio", source: "ratio", type: "string" }] } }
    }),
    fetcher: async (url, init) => {
      if (String(url).includes("/videos/generations")) {
        const submitted = JSON.parse(init.body);
        assert.equal(submitted.metadata.ratio, "16:9");
        assert.equal(submitted.prompt, "cinema");
        assert.equal(submitted.model, "upstream-model");
        return json({ task_id: "ac-5" });
      }
      assert.ok(String(url).includes("/videos/ac-5"));
      return json({ status: "completed", result_url: "https://cdn.example.com/aicopy.mp4" });
    }
  }, codec);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.result.videoUrls, ["https://cdn.example.com/aicopy.mp4"]);
  assert.equal(result.result.adapter, "aicopy-video");
});

test("gemini chat goes through generateContent with x-goog-api-key", async () => {
  const result = await executeTask({
    task: makeTask({ protocol: "gemini", capability: "chat", prompt: "描述图片", input: {} }),
    provider: providerView({ protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com" }),
    model: model({ capability: "chat" }),
    fetcher: async (url, init) => {
      assert.ok(String(url).includes(":generateContent"));
      assert.equal(init.headers["x-goog-api-key"], "sk-test");
      return json({ candidates: [{ content: { parts: [{ text: "这是一张测试图" }] }, finishReason: "STOP" }] });
    }
  }, codec);
  assert.equal(result.status, "succeeded");
  assert.equal(result.result.text, "这是一张测试图");
  assert.equal(result.result.adapter, "gemini-generate-content");
});

test("runninghub catalog flow submits workflow and extracts outputs", async () => {
  const result = await executeTask({
    task: makeTask({
      protocol: "runninghub",
      capability: "video",
      prompt: "",
      input: {},
      runninghub: {
        catalogId: "prov:workflow:999",
        kind: "workflow",
        runTargetId: "999",
        submitMode: "openapi-v2-workflow",
        nodeInfoList: [{ nodeId: "10", fieldName: "video", fieldValue: "in.mp4" }],
        pollIntervalMs: 1,
        timeoutMs: 60000
      }
    }),
    provider: providerView({ protocol: "runninghub", baseUrl: "https://rh.example.com", apiKeyPlain: "rh-key" }),
    model: null,
    fetcher: async (url, init) => {
      if (String(url).includes("/openapi/v2/run/workflow/999")) {
        const body = JSON.parse(init.body);
        assert.equal(body.workflowId, "999");
        assert.deepEqual(body.nodeInfoList, [{ nodeId: "10", fieldName: "video", fieldValue: "in.mp4" }]);
        return json({ code: 0, data: { taskId: "rh-1" } });
      }
      assert.ok(String(url).includes("/openapi/v2/query"));
      return json({ code: 0, status: "SUCCESS", data: { outputs: ["https://cdn.example.com/rh-out.mp4"] } });
    }
  }, codec);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.result.videoUrls, ["https://cdn.example.com/rh-out.mp4"]);
  assert.equal(result.result.upstreamTaskId, "rh-1");
});

test("capability gates stay explicit instead of guessing", async () => {
  const geminiVideo = await executeTask({
    task: makeTask({ protocol: "gemini", capability: "video", prompt: "x", input: {} }),
    provider: providerView({ protocol: "gemini" }),
    model: model({ capability: "video" }),
    fetcher: async () => { throw new Error("should not be called"); }
  }, codec);
  assert.equal(geminiVideo.status, "failed");
  assert.match(geminiVideo.result.error, /仅支持 chat/);

  const grsaiChat = await executeTask({
    task: makeTask({ protocol: "grsai_draw", capability: "chat", prompt: "x", input: {} }),
    provider: providerView({ protocol: "grsai_draw", baseUrl: "https://grsai.example.com" }),
    model: model({ capability: "chat" }),
    fetcher: async () => { throw new Error("should not be called"); }
  }, codec);
  assert.equal(grsaiChat.status, "failed");
  assert.match(grsaiChat.result.error, /仅支持图像/);

  const aicopyImage = await executeTask({
    task: makeTask({ protocol: "aicopy", capability: "image", prompt: "x", input: {} }),
    provider: providerView({ protocol: "aicopy" }),
    model: model(),
    fetcher: async () => { throw new Error("should not be called"); }
  }, codec);
  assert.equal(aicopyImage.status, "failed");
  assert.match(aicopyImage.result.error, /仅支持 video\/chat/);
});

test("upstream failures carry recoverable categories", async () => {
  const failure = await executeTask({
    task: makeTask({ protocol: "openai", capability: "chat", prompt: "hi", input: {} }),
    provider: providerView(),
    model: model({ capability: "chat" }),
    fetcher: async () => json({ error: { message: "invalid key" } }, 401)
  }, codec);
  assert.equal(failure.status, "failed");
  assert.equal(failure.result.failureCategory, "upstream_failed");
  assert.equal(failure.result.recoverable, false);
  assert.match(failure.result.error, /401|invalid key/);
});
