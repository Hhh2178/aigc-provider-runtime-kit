import test from "node:test";
import assert from "node:assert/strict";
import { Router, readCookie, buildSessionCookie, corsHeaders } from "@aigc-kit/control-center/http";

test("router matches literal and parameterized paths with method check", async () => {
  const router = new Router();
  const hits = [];
  router.add("GET", "/healthz", async () => { hits.push("health"); });
  router.add("PATCH", "/api/admin/providers/:id", async ({ params }) => { hits.push(params.id); });
  router.add("GET", "/api/admin/providers/:id/runninghub/key-pool/:keyId", async ({ params }) => { hits.push(`${params.id}/${params.keyId}`); });

  assert.equal(await router.dispatch(requestStub("GET", "/healthz")), true);
  assert.equal(await router.dispatch(requestStub("POST", "/healthz")), false);
  assert.equal(await router.dispatch(requestStub("PATCH", "/api/admin/providers/abc%20def")), true);
  assert.equal(await router.dispatch(requestStub("GET", "/api/admin/providers/p1/runninghub/key-pool/key%2F9")), true);
  assert.equal(await router.dispatch(requestStub("GET", "/nope/nothing")), false);
  assert.deepEqual(hits, ["health", "abc def", "p1/key/9"]);
});

test("cookies and cors are read and produced properly", () => {
  const request = { headers: { cookie: "cc_session=abc123; other=1" } };
  assert.equal(readCookie(request, "cc_session"), "abc123");
  assert.equal(readCookie({ headers: {} }, "cc_session"), "");

  const cookie = buildSessionCookie({ headers: { host: "localhost:8787" } }, "sess-1");
  assert.ok(cookie.includes("cc_session=sess-1"));
  assert.ok(cookie.includes("HttpOnly"));

  assert.deepEqual(corsHeaders(""), {});
  const cors = corsHeaders("https://app.example.com");
  assert.equal(cors["access-control-allow-origin"], "https://app.example.com");
  assert.equal(cors["access-control-allow-credentials"], "true");
});

function requestStub(method, path) {
  return {
    response: {}, url: new URL(path, "http://internal"),
    requestContext: { requestId: "r1", method, path, ip: "127.0.0.1", userAgent: "test", startedAt: Date.now() },
    request: { method, headers: {} }
  };
}
