import test from "node:test";
import assert from "node:assert/strict";
import {
  createAicopyVideoAdapterPayload,
  mergeAicopySdRequestContractDefaults,
  resolveAicopyRequestContractEnabled,
  extractAicopyTask,
  extractAicopyVideoResult,
  extractAicopyFailureReason,
  pollAicopyVideoTask
} from "@aigc-kit/control-center/worker/adapters/aicopy";
import {
  executeGeminiChat,
  buildGenerateContentBody,
  geminiApiRoot,
  geminiParts
} from "@aigc-kit/control-center/worker/adapters/gemini";
import { deliverTaskCallback } from "@aigc-kit/control-center/worker/callback";

test("aicopy default mapping and SD contract binding both shape payloads", () => {
  const mapped = createAicopyVideoAdapterPayload({
    modelId: "aicopy-video",
    prompt: "a fox",
    ratio: "16:9",
    duration: 5,
    images: ["https://example.com/a.png"],
    fixedBody: { trace: "on" }
  });
  assert.equal(mapped.model, "aicopy-video");
  assert.equal(mapped.size, "1280x720");
  assert.equal(mapped.seconds, 5);
  assert.deepEqual(mapped.images, ["https://example.com/a.png"]);
  assert.equal(mapped.trace, "on");

  const sdConfig = mergeAicopySdRequestContractDefaults({});
  assert.equal(resolveAicopyRequestContractEnabled(sdConfig), true);
  const contracted = createAicopyVideoAdapterPayload({
    modelId: "sd-video",
    prompt: "walk",
    ratio: "9:16",
    duration: 4,
    modeType: "image2video",
    images: ["https://example.com/b.png"],
    requestContractEnabled: true,
    requestContract: sdConfig.requestContract
  });
  assert.equal(contracted.duration, 4);
  assert.equal(contracted.metadata.ratio, "9:16");
  assert.equal(contracted.metadata.modeType, "image2video");
  assert.equal(contracted.metadata.enableSound, "on");
  assert.deepEqual(contracted.images, ["https://example.com/b.png"]);
  assert.equal(contracted.size, undefined);
});

test("aicopy task/result/failure extraction across shapes", () => {
  const task = extractAicopyTask({ data: { task_id: "ac-1", status: "queued" } });
  assert.equal(task.taskId, "ac-1");
  assert.equal(task.status, "queued");

  const result = extractAicopyVideoResult({ result_url: "https://cdn.example.com/ac.mp4", status: "completed" });
  assert.deepEqual(result.videoUrls, ["https://cdn.example.com/ac.mp4"]);
  assert.equal(result.status, "completed");

  const nested = extractAicopyFailureReason({ data: { error: JSON.stringify({ message: "insufficient balance" }) } });
  assert.equal(nested, "insufficient balance");
});

test("aicopy polling returns urls, content fallback, and failure detail", async () => {
  let calls = 0;
  const heartbeats = [];
  const success = await pollAicopyVideoTask({
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    taskId: "ac-9",
    pollIntervalMs: 1,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ status: "processing" }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: "completed", result_url: "https://cdn.example.com/final.mp4" }) };
    },
    onHeartbeat: async (patch) => { heartbeats.push(patch); }
  });
  assert.deepEqual(success.videoUrls, ["https://cdn.example.com/final.mp4"]);
  assert.equal(heartbeats[0].upstreamStatus, "processing");

  const fallback = await pollAicopyVideoTask({
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    taskId: "ac-10",
    pollIntervalMs: 1,
    fetcher: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "done" }) })
  });
  assert.equal(fallback.usedContentFallback, true);
  assert.ok(fallback.videoUrls[0].includes("videos/ac-10/content"));

  await assert.rejects(
    pollAicopyVideoTask({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      taskId: "ac-11",
      pollIntervalMs: 1,
      fetcher: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "failed", message: "bad params" }) })
    }),
    /视频任务失败: bad params/
  );
});

test("gemini request building maps roles, system parts, and image data urls", () => {
  assert.equal(geminiApiRoot("https://generativelanguage.googleapis.com"), "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(geminiApiRoot("https://x.example.com/v1beta/"), "https://x.example.com/v1beta");

  const parts = geminiParts([
    { type: "text", text: "看看这张图" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
  ]);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[1].inline_data, { mime_type: "image/png", data: "AAAA" });

  const body = buildGenerateContentBody({
    messages: [
      { role: "system", content: "你是画布助手" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" }
    ],
    temperature: 0.4,
    maxTokens: 64
  });
  assert.equal(body.systemInstruction.parts[0].text, "你是画布助手");
  assert.deepEqual(body.contents.map((item) => item.role), ["user", "model"]);
  assert.equal(body.generationConfig.temperature, 0.4);
  assert.equal(body.generationConfig.maxOutputTokens, 64);
});

test("gemini chat executes against a fake upstream and surfaces failures", async () => {
  const ok = await executeGeminiChat({
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "g-key",
    modelId: "gemini-2.5-flash",
    messages: [{ role: "user", content: "连接正常?" }],
    fetcher: async (url) => {
      assert.ok(String(url).includes("/models/gemini-2.5-flash:generateContent"));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "连接正常" }] }, finishReason: "STOP" }] })
      };
    }
  });
  assert.equal(ok.text, "连接正常");
  assert.equal(ok.finishReason, "STOP");

  await assert.rejects(
    executeGeminiChat({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "g-key",
      modelId: "gemini-2.5-flash",
      messages: [],
      fetcher: async () => ({ ok: false, status: 429, text: async () => "quota" })
    }),
    /GEMINI_GENERATE_FAILED:429/
  );

  await assert.rejects(
    executeGeminiChat({ baseUrl: "http://insecure.example.com", apiKey: "k", modelId: "m", messages: [] }),
    /GEMINI_BASE_URL_INVALID/
  );
});

test("callback delivery posts terminal state and never throws", async () => {
  const posts = [];
  const delivered = await deliverTaskCallback("https://host.example.com/hooks/task", {
    taskId: "task-1",
    status: "succeeded",
    capability: "image",
    providerId: "prov",
    result: { imageUrls: ["https://cdn.example.com/x.png"] }
  }, {
    fetcher: async (url, init) => {
      posts.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => "" };
    }
  });
  assert.equal(delivered.delivered, true);
  assert.equal(posts[0].body.status, "succeeded");
  assert.deepEqual(posts[0].body.result.imageUrls, ["https://cdn.example.com/x.png"]);

  const skipped = await deliverTaskCallback(undefined, { taskId: "t", status: "failed", capability: "chat", providerId: "p", result: {} });
  assert.equal(skipped.attempted, false);

  const invalid = await deliverTaskCallback("ftp://nope", { taskId: "t", status: "failed", capability: "chat", providerId: "p", result: {} });
  assert.equal(invalid.attempted, false);
  assert.ok(invalid.error);

  const failed = await deliverTaskCallback("https://host.example.com/hooks/task", {
    taskId: "t", status: "failed", capability: "chat", providerId: "p", result: { error: "boom" }
  }, { fetcher: async () => { throw new Error("network down"); } });
  assert.equal(failed.attempted, true);
  assert.equal(failed.delivered, false);
  assert.equal(failed.error, "network down");
});
