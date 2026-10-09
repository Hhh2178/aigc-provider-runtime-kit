import test from "node:test";
import assert from "node:assert/strict";
import { probeProvider } from "@aigc-kit/control-center/domain/provider-probe";
import { createSecretCodec } from "@aigc-kit/control-center/crypto";

function jsonResponse(body, status = 200) {
  return {
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : null }
  };
}

const codec = createSecretCodec("probe-test-secret");

test("probe validates URL/key/API shape and counts models", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    throw new Error("should not be called yet");
  };

  assert.equal((await probeProvider({ baseUrl: "", protocol: "openai" }, { fetcher, codec })).message, "请先填写请求地址");
  assert.equal((await probeProvider({ baseUrl: "https://api.example.com/v1" }, { fetcher, codec })).message, "请先填写或保存 API Key");

  const failing = await probeProvider({ baseUrl: "ftp://nope", protocol: "openai" }, { fetcher, codec });
  assert.equal(failing.ok, false);

  const listFetcher = async (url) => {
    calls.push(url);
    return jsonResponse({ data: [{ id: "gpt-image-2" }, { id: "gpt-5" }] });
  };
  const ok = await probeProvider(
    { id: "prov", name: "示例", baseUrl: "https://api.example.com/v1", protocol: "openai", apiKey: codec.encrypt("sk-test") },
    { fetcher: listFetcher, codec }
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.modelCount, 2);
  assert.deepEqual(ok.imageModels, ["gpt-image-2"]);
  assert.equal(calls.at(-1), "https://api.example.com/v1/models");
});

test("probe flags HTML responses and upstream failures", async () => {
  const htmlFetcher = async () => ({
    ok: true,
    status: 200,
    text: async () => "<!doctype html><html>login page</html>",
    headers: { get: () => "text/html" }
  });
  const html = await probeProvider({ baseUrl: "https://api.example.com/v1", apiKey: "sk" }, { fetcher: htmlFetcher, codec });
  assert.equal(html.ok, false);
  assert.ok(html.message.includes("HTML"));

  const failingFetcher = async () => jsonResponse({ error: { message: "bad key" } }, 401);
  const failing = await probeProvider({ baseUrl: "https://api.example.com/v1", apiKey: "sk" }, { fetcher: failingFetcher, codec });
  assert.equal(failing.ok, false);
  assert.equal(failing.status, 401);
});

test("grsai providers use the manual catalog shortcut", async () => {
  let called = false;
  const neverFetcher = async () => { called = true; return jsonResponse({ data: [] }); };
  const result = await probeProvider({ id: "grsai", name: "GRSAI", baseUrl: "https://grsai.dakka.com.com.cn/api", protocol: "openai", apiKey: "sk" }, { fetcher: neverFetcher, codec });
  assert.equal(result.ok, true);
  assert.deepEqual(result.imageModels, ["gpt-image-2"]);
  assert.equal(called, false);
});
