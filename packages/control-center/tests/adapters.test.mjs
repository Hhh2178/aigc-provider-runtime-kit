import test from "node:test";
import assert from "node:assert/strict";
import {
  createApimartVideoAdapterPayload,
  extractApimartTask,
  extractApimartVideoResult,
  extractApimartFailureReason,
  shouldUseApimartVideoAdapter,
  isCompletedAsyncStatus,
  isFailedAsyncStatus,
  extractModelScopeImageTask,
  modelScopeHeaders,
  pollApimartVideoTask,
  extractDirectImageUrls
} from "@aigc-kit/control-center/worker/adapters/apimart";
import { createGrsaiImageClient } from "@aigc-kit/control-center/worker/adapters/grsai";

test("apimart payload applies mapping, value types, templates, and fixed body", () => {
  const payload = createApimartVideoAdapterPayload({
    modelId: "video-model",
    prompt: "a cat",
    ratio: "16:9",
    duration: 5,
    resolution: "720p",
    images: ["https://example.com/a.png"],
    requestMapping: { ratio: "aspect_ratio" },
    requestValueTypes: { duration: "number" },
    requestValueTemplates: { video_size: "{video_size}" },
    fixedBody: { custom_flag: true }
  });
  assert.equal(payload.model, "video-model");
  assert.equal(payload.prompt, "a cat");
  assert.equal(payload.aspect_ratio, "16:9");
  assert.equal(payload.duration, 5);
  assert.equal(payload.custom_flag, true);
  assert.equal(payload.video_size, "1280x720");
  assert.equal(payload.size, undefined);
});

test("apimart task and result extraction tolerate multiple response shapes", () => {
  const submit = extractApimartTask({ data: [{ task_id: "t-1", status: "queued" }] });
  assert.equal(submit.taskId, "t-1");
  assert.equal(submit.status, "queued");

  const generic = extractApimartTask({ request_id: "req-9" });
  assert.equal(generic.taskId, "req-9");

  const video = extractApimartVideoResult({ data: { status: "completed", result: { videos: ["https://cdn.example.com/out.mp4"] } } });
  assert.equal(video.status, "completed");
  assert.deepEqual(video.videoUrls, ["https://cdn.example.com/out.mp4"]);

  const failure = extractApimartFailureReason({ data: { error: { message: "quota exceeded" } } });
  assert.equal(failure, "quota exceeded");

  assert.equal(shouldUseApimartVideoAdapter({ protocol: "apimart" }), true);
  assert.equal(shouldUseApimartVideoAdapter({ advancedMode: "async_video_task" }), true);
  assert.equal(shouldUseApimartVideoAdapter({ protocol: "openai" }), false);
  assert.equal(isCompletedAsyncStatus("SUCCESS".toLowerCase()), true);
  assert.equal(isFailedAsyncStatus("failed"), true);
});

test("apimart video polling returns urls and heartbeats", async () => {
  let pollCount = 0;
  const heartbeats = [];
  const fetcher = async (url) => {
    assert.ok(String(url).includes("tasks/t%2D9") || String(url).includes("tasks/t-9"));
    pollCount += 1;
    if (pollCount === 1) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { status: "running" } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { status: "completed", result: { videos: ["https://cdn.example.com/final.mp4"] } } }) };
  };
  const result = await pollApimartVideoTask({
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    taskId: "t-9",
    pollIntervalMs: 1,
    fetcher,
    onHeartbeat: async (patch) => { heartbeats.push(patch); }
  });
  assert.deepEqual(result.videoUrls, ["https://cdn.example.com/final.mp4"]);
  assert.equal(heartbeats[0].upstreamStatus, "running");
});

test("apimart failure statuses raise with upstream reason", async () => {
  const fetcher = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { status: "failed", failure_reason: "no credits" } }) });
  await assert.rejects(
    pollApimartVideoTask({ baseUrl: "https://api.example.com/v1", apiKey: "k", taskId: "t-1", pollIntervalMs: 1, fetcher }),
    /视频任务失败: no credits/
  );
});

test("grsai client returns immediate urls and polls pending tasks", async () => {
  const immediate = createGrsaiImageClient({ apiKey: "k", baseUrl: "https://grsai.example.com", fetcher: async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { results: [{ url: "https://cdn.example.com/a.png" }] } })
  }) });
  const direct = await immediate.generate({ modelId: "grsai-model", prompt: "cat" });
  assert.deepEqual(direct.imageUrls, ["https://cdn.example.com/a.png"]);

  let polls = 0;
  const pending = createGrsaiImageClient({ apiKey: "k", baseUrl: "https://grsai.example.com", pollIntervalMs: 1, fetcher: async (url) => {
    if (String(url).endsWith("/v1/draw/completions")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { id: "g-1", status: "pending" } }) };
    }
    polls += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { id: "g-1", status: "success", results: [{ imageUrl: "https://cdn.example.com/b.png" }] } }) };
  } });
  const polled = await pending.generate({ modelId: "grsai-model", prompt: "cat" });
  assert.deepEqual(polled.imageUrls, ["https://cdn.example.com/b.png"]);
  assert.equal(polled.taskId, "g-1");
  assert.ok(polls >= 1);
});

test("grsai failure and sse-style bodies are surfaced clearly", async () => {
  const failed = createGrsaiImageClient({ apiKey: "k", baseUrl: "https://grsai.example.com", pollIntervalMs: 1, fetcher: async (url) => {
    if (String(url).endsWith("/v1/draw/completions")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { id: "g-2", status: "pending" } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { id: "g-2", status: "failed", error: "rate limited" } }) };
  } });
  await assert.rejects(failed.generate({ modelId: "grsai-model", prompt: "cat" }), /rate limited/);

  const sse = createGrsaiImageClient({ apiKey: "k", baseUrl: "https://grsai.example.com", fetcher: async () => ({
    ok: true, status: 200, text: async () => `data: ${JSON.stringify({ data: { results: [{ url: "https://cdn.example.com/sse.png" }] } })}`
  }) });
  const sseResult = await sse.generate({ modelId: "grsai-model", prompt: "cat" });
  assert.deepEqual(sseResult.imageUrls, ["https://cdn.example.com/sse.png"]);
});

test("modelscope headers and task extraction", () => {
  const submit = modelScopeHeaders("sk", "submit");
  assert.equal(submit["X-ModelScope-Async-Mode"], "true");
  const poll = modelScopeHeaders("sk", "poll");
  assert.equal(poll["X-ModelScope-Task-Type"], "image_generation");
  const task = extractModelScopeImageTask({ task_id: "ms-1", task_status: "RUNNING" }, {});
  assert.equal(task.taskId, "ms-1");
  assert.equal(task.status, "RUNNING");
});

test("extractDirectImageUrls collects urls, data urls and dedupes", () => {
  const urls = extractDirectImageUrls({
    data: [
      { url: "https://cdn.example.com/a.png" },
      { b64_json: "data:image/png;base64,AAAA" },
      { url: "https://cdn.example.com/a.png" }
    ]
  });
  assert.deepEqual(urls, ["https://cdn.example.com/a.png", "data:image/png;base64,AAAA"]);
});
