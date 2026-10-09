export interface ControlCenterConfig {
  port: number;
  databaseUrl: string;
  /** Root secret used to derive AES-256-GCM keys for stored provider credentials. */
  secretKey: string;
  adminEmail: string;
  adminPassword: string;
  bootstrapOnStart: boolean;
  sessionTtlHours: number;
  /** Optional allowed origin for CORS; empty disables CORS headers. */
  corsOrigin: string;
  tenantId: string;
  /**
   * Machine token for the task API (/api/tasks*). When set, host applications may
   * submit/poll/cancel tasks with `Authorization: Bearer <token>` instead of an
   * admin session. Empty value falls those routes back to admin sessions only.
   */
  taskApiToken: string;
  /** Default worker claim slot count when started via createTaskWorker. */
  workerConcurrency: number;
  /**
   * Optional local directory for materialized outputs. Empty disables
   * materialization (remote URLs are returned as-is).
   */
  storageDir: string;
  log: (message: string) => void;
  warn: (message: string) => void;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ControlCenterConfig {
  const databaseUrl = String(env.CC_DATABASE_URL || env.DATABASE_URL || "").trim();
  const port = normalizePort(env.CC_PORT ?? env.PORT, 8787);
  const secretKey = String(env.CC_SECRET_KEY || "").trim();
  const adminEmail = String(env.CC_ADMIN_EMAIL || "admin@localhost").trim().toLowerCase();
  const adminPassword = String(env.CC_ADMIN_PASSWORD || "").trim() || "control-center-admin";
  if (databaseUrl && !secretKey) {
    throw new Error("CC_SECRET_KEY is required when CC_DATABASE_URL is configured: provider credentials are encrypted with it");
  }
  return {
    port,
    databaseUrl,
    secretKey: secretKey || "aigc-provider-control-center-dev-secret",
    adminEmail,
    adminPassword,
    bootstrapOnStart: env.CC_BOOTSTRAP_ADMIN !== "0",
    sessionTtlHours: clampNumber(Number(env.CC_SESSION_TTL_HOURS ?? 72), 1, 24 * 30, 72),
    corsOrigin: String(env.CC_CORS_ORIGIN || "").trim(),
    tenantId: String(env.CC_TENANT_ID || "default").trim().slice(0, 80) || "default",
    taskApiToken: String(env.CC_TASK_API_TOKEN || "").trim(),
    workerConcurrency: clampNumber(Number(env.CC_WORKER_CONCURRENCY ?? 4), 1, 64, 4),
    storageDir: String(env.CC_STORAGE_DIR || "").trim(),
    log: (message: string) => console.log(message),
    warn: (message: string) => console.warn(message)
  };
}

function normalizePort(value: unknown, fallback: number) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return fallback;
  return port;
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
