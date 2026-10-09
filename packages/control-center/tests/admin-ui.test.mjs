import test from "node:test";
import assert from "node:assert/strict";
import { Router } from "@aigc-kit/control-center/http";
import { registerAdminUiRoutes, ADMIN_HTML } from "@aigc-kit/control-center/routes/admin-ui";

test("admin console is served without a build step and is gated client-side", async () => {
  const router = new Router();
  registerAdminUiRoutes(router);

  const response = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(body) { this.body = body; }
  };
  const handled = await router.dispatch({
    request: { method: "GET", headers: {} },
    response,
    url: new URL("http://internal/admin"),
    requestContext: { requestId: "r", method: "GET", path: "/admin", ip: "", userAgent: "test", startedAt: Date.now() }
  });
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.ok(String(response.body).includes("服务商与 RH 管理中控"));

  // The page itself is static; every data call still goes through the
  // protected admin APIs, so no privileged data is embedded in the HTML.
  for (const anchor of ["/api/auth/admin-login", "/api/admin/providers", "/api/admin/tasks", "/api/admin/pricing", "/api/admin/costs/summary"]) {
    assert.ok(response.body.includes(anchor), `console must call ${anchor}`);
  }
  assert.ok(!response.body.includes("enc:v1:"), "no ciphertext in the served page");
  assert.ok(ADMIN_HTML.length > 4000, "console ships real content");
});
