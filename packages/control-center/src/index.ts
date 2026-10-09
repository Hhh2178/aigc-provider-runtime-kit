import { createServer, type Server } from "node:http";
import type { ControlCenterConfig } from "./config.js";
import { createDatabase, type ControlCenterDatabase } from "./db.js";
import { createSecretCodec, type SecretCodec } from "./crypto.js";
import { createProviderRepository, type ProviderRepository } from "./repository/providers.js";
import { createTaskRepository, type TaskRepository } from "./repository/tasks.js";
import { createAuditRepository, createAuditReader } from "./repository/audit.js";
import { createAuthRepository, type AuthRepository, type AdminUserRecord } from "./repository/auth.js";
import { createRunningHubCatalogService, type RhCatalogService } from "./domain/runninghub/service.js";
import {
  buildSessionCookie, corsHeaders, expireSessionCookie, HttpError, readCookie, readJsonBody, requestIp, requestId, sendError, sendJson, Router
} from "./http.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerProviderAdminRoutes } from "./routes/providers.js";
import { registerModelAdminRoutes } from "./routes/models.js";
import { registerRunningHubAdminRoutes } from "./routes/runninghub.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { readBearerToken } from "./http.js";

export interface ControlCenterServices {
  repository: ProviderRepository;
  tasks: TaskRepository;
  auth: AuthRepository;
  appendAudit: (actor: AdminUserRecord, action: string, targetType: string, targetId: string, summary: string, requestContext: RequestBrief) => Promise<void>;
  readAuditLogs: (options?: { limit?: number; action?: string }) => Promise<Record<string, unknown>[]>;
  runningHub: RhCatalogService;
  codec: SecretCodec;
}

export interface RequestBrief {
  requestId: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  startedAt: number;
}

export interface RunningControlCenter {
  server: Server;
  listen: () => Promise<void>;
  port: number;
  config: ControlCenterConfig;
  services: ControlCenterServices;
  database: ControlCenterDatabase | null;
  close: () => Promise<void>;
}

export async function createControlCenter(config: ControlCenterConfig, options: { databaseUrl?: string } = {}): Promise<RunningControlCenter> {
  const databaseUrl = options.databaseUrl ?? config.databaseUrl;
  const database = databaseUrl ? createDatabase(databaseUrl, config.log) : null;
  if (database) await database.migrate();
  const executor = database ? database.pool : null;
  if (!executor) throw new Error("control-center requires a PostgreSQL database URL (CC_DATABASE_URL)");

  const codec = createSecretCodec(config.secretKey);
  const auth = createAuthRepository(executor);
  const repository = createProviderRepository(executor, codec, config.tenantId);
  const tasks = createTaskRepository(executor, config.tenantId);
  const appendAudit = createAuditRepository(executor);
  const readAuditLogs = createAuditReader(executor);
  const runningHub = createRunningHubCatalogService(repository);

  const services: ControlCenterServices = { repository, tasks, auth, appendAudit, readAuditLogs, runningHub, codec };

  if (config.bootstrapOnStart) {
    const admin = await auth.ensureBootstrapAdmin({ email: config.adminEmail, password: config.adminPassword });
    config.log(`control-center: bootstrap admin ready (${admin.email}); set CC_ADMIN_PASSWORD to change the password.`);
  }

  const router = new Router();
  registerMetaRoutes(router, { config });
  registerAuthRoutes(router, { config, services });
  // Admin routes assume the /api/admin/* gateway already enforced the session.
  registerProviderAdminRoutes(router, { config, services });
  registerModelAdminRoutes(router, { config, services });
  registerRunningHubAdminRoutes(router, { config, services });
  // /api/tasks* requires either the machine token (CC_TASK_API_TOKEN) or an admin session.
  registerTaskRoutes(router, { config, services });

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  async function handleRequest(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
    const url = new URL(String(request.url || "/"), "http://internal");
    const requestContext: RequestBrief = {
      requestId: requestId(),
      method: String(request.method || "GET"),
      path: url.pathname,
      ip: requestIp(request),
      userAgent: String(request.headers["user-agent"] || ""),
      startedAt: Date.now()
    };
    for (const [key, value] of Object.entries(corsHeaders(config.corsOrigin))) response.setHeader(key, value);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    try {
      const adminUser = url.pathname.startsWith("/api/admin/")
        ? await requireAdminSession(request)
        : url.pathname.startsWith("/api/tasks")
          ? await authorizeTaskPrincipal(request)
          : undefined;
      const handled = await router.dispatch({ request, response, url, requestContext, admin: adminUser });
      if (!handled) throw new HttpError(404, "接口不存在");
    } catch (error) {
      // Errors during body reads leave the socket half-open; close politely.
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof HttpError ? error.statusCode : 500;
      try {
        sendJson(response, { error: status === 500 ? "REQUEST_FAILED" : "REQUEST_ERROR", message }, status);
      } catch {
        response.destroy();
      }
      if (status === 500) config.warn(`request failed ${request.method} ${url.pathname}: ${message}`);
    }
  }

  async function requireAdminSession(request: import("node:http").IncomingMessage): Promise<AdminUserRecord> {
    const sessionId = readCookie(request, "cc_session");
    const session = sessionId ? await services.auth.readSession(sessionId) : null;
    if (!session || !session.user || session.user.role !== "admin") throw new HttpError(403, "ADMIN_REQUIRED");
    return session.user;
  }

  /**
   * /api/tasks* accepts a machine bearer token (CC_TASK_API_TOKEN) when configured;
   * with no token configured it degrades to admin-session auth so the routes are
   * never silently open.
   */
  async function authorizeTaskPrincipal(request: import("node:http").IncomingMessage): Promise<AdminUserRecord | undefined> {
    const token = readBearerToken(request);
    if (config.taskApiToken) {
      if (!token || token !== config.taskApiToken) throw new HttpError(403, "TASK_TOKEN_INVALID");
      return undefined;
    }
    return requireAdminSession(request);
  }

  const serverListen = () => new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));

  async function close() {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database?.close();
  }

  return {
    server,
    listen: serverListen,
    port: config.port,
    config,
    services,
    database,
    close
  };
}
