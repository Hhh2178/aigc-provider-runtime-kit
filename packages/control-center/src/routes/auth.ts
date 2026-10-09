import { buildSessionCookie, expireSessionCookie, readCookie, readJsonBody, sendJson, Router } from "../http.js";
import type { ControlCenterServices } from "../index.js";
import type { ControlCenterConfig } from "../config.js";

export function registerAuthRoutes(router: Router, deps: { config: ControlCenterConfig; services: ControlCenterServices }) {
  const { services, config } = deps;

  router.add("POST", "/api/auth/admin-login", async ({ request, response, requestContext }) => {
    if (!config.databaseUrl) throw getSessionUnavailableError();
    const body = await readJsonBody<{ email?: string; password?: string }>(request);
    const user = await services.auth.verifyLogin(String(body.email || ""), String(body.password || ""));
    if (!user) {
      sendJson(response, { error: "INVALID_CREDENTIALS" }, 401);
      return;
    }
    const session = await services.auth.createSession({ userId: user.id, userAgent: requestContext.userAgent, ip: requestContext.ip, ttlHours: config.sessionTtlHours });
    await services.appendAudit(user, "auth.admin_login", "auth", user.id, `管理员登录 ${user.email}`, requestContext);
    sendJson(response, { authenticated: true, user: toPublicUser(user) }, 200, {
      "set-cookie": buildSessionCookie(request, session.id)
    });
  });

  router.add("POST", "/api/auth/logout", async ({ request, response, admin }) => {
    const sessionId = readCookie(request, "cc_session");
    if (sessionId) await services.auth.revokeSession(sessionId);
    if (admin) {
      await services.appendAudit(admin, "auth.admin_logout", "auth", admin.id, `管理员退出 ${admin.email}`, fallbackContext());
    }
    sendJson(response, { authenticated: false }, 200, { "set-cookie": expireSessionCookie() });
  });

  router.add("GET", "/api/auth/me", async ({ request, response, admin }) => {
    if (!admin) {
      const session = await services.auth.readSession(readCookie(request, "cc_session"));
      if (session?.user) {
        sendJson(response, { authenticated: true, user: toPublicUser(session.user) });
        return;
      }
      sendJson(response, { authenticated: false }, 401);
      return;
    }
    sendJson(response, { authenticated: true, user: toPublicUser(admin) });
  });
}


function toPublicUser(user: { id: string; email: string; name: string; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function getSessionUnavailableError() {
  return new Error("AUTH_STORAGE_UNAVAILABLE");
}

function fallbackContext() {
  return { requestId: "local", method: "POST", path: "/api/auth/logout", ip: "", userAgent: "", startedAt: Date.now() };
}
