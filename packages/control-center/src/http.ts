import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export function sendJson(response: ServerResponse, payload: unknown, statusCode = 200, headers: Record<string, string> = {}) {
  const body = JSON.stringify({ ok: statusCode < 400, success: statusCode < 400, ...(payload === undefined ? {} : (payload as object)) });
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
  response.end(body);
}

export function sendError(response: ServerResponse, error: unknown, statusCode = 500) {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, { error: "REQUEST_FAILED", message }, statusCode);
}

export async function readJsonBody<T = Record<string, unknown>>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    received += buffer.byteLength;
    if (received > MAX_BODY_BYTES) throw new HttpError(413, "请求体过大");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "请求体必须是合法 JSON");
  }
}

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function readCookie(request: IncomingMessage, name: string): string {
  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function readBearerToken(request: IncomingMessage): string {
  const header = String(request.headers.authorization || "");
  const match = header.match(/^Bearers+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function buildSessionCookie(request: IncomingMessage, sessionId: string) {
  const host = String(request.headers.host || "").split(":")[0];
  return [
    `cc_session=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(host && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host) ? [] : []),
    `Max-Age=${72 * 3600}`
  ].join("; ");
}

export function expireSessionCookie() {
  return "cc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

export function requestIp(request: IncomingMessage) {
  const forwarded = (String(request.headers["x-forwarded-for"] || "").split(",")[0] ?? "").trim();
  return forwarded || request.socket.remoteAddress || "";
}

export function requestId() {
  return `req-${randomUUID()}`;
}

export interface RouteMatch {
  params: Record<string, string>;
}

type RouteHandler = (input: RouteContext) => Promise<boolean | void>;

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  params: Record<string, string>;
  requestContext: { requestId: string; method: string; path: string; ip: string; userAgent: string; startedAt: number };
  /** Present only on /api/admin/* by the time a route handler runs. */
  admin?: import("./repository/auth.js").AdminUserRecord | undefined;
}

export class Router {
  private readonly routes: Array<{ method: string; pattern: RegExp; paramNames: string[]; handler: RouteHandler }> = [];

  add(method: string, pattern: string, handler: RouteHandler) {
    const paramNames: string[] = [];
    const regexSource = pattern
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          paramNames.push(segment.slice(1));
          return "([^/]+)";
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ method, pattern: new RegExp(`^${regexSource}$`), paramNames, handler });
  }

  async dispatch(input: Omit<RouteContext, "params"> & { params?: Record<string, string> }): Promise<boolean> {
    const { request, url } = input;
    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1] ?? "");
      });
      await route.handler({ ...input, params });
      return true;
    }
    return false;
  }
}

export function corsHeaders(origin: string): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-credentials": "true"
  };
}
