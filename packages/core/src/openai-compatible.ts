import { withRetry, type RetryOptions } from "./retry.js";

export interface OpenAICompatibleClientOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
  retry?: RetryOptions | false;
}

export interface OpenAICompatibleRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  retry?: RetryOptions | false;
}

export type OpenAICompatibleErrorCode = "INVALID_CONFIGURATION" | "REQUEST_ABORTED" | "REQUEST_FAILED" | "INVALID_RESPONSE";

export class OpenAICompatibleError extends Error {
  readonly code: OpenAICompatibleErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly requestId: string | undefined;

  constructor(code: OpenAICompatibleErrorCode, message: string, options: { status?: number; retryable?: boolean; requestId?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "OpenAICompatibleError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
  }
}

export function isOpenAICompatibleError(value: unknown): value is OpenAICompatibleError {
  return value instanceof OpenAICompatibleError;
}

export function createOpenAICompatibleClient(options: OpenAICompatibleClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;
  const requestTimeoutMs = normalizeTimeout(options.requestTimeoutMs, 120_000);

  async function request<T = Record<string, unknown>>(path: string, body: Record<string, unknown>, requestOptions: OpenAICompatibleRequestOptions = {}): Promise<T> {
    const url = resolveEndpoint(baseUrl, path);
    const retryOptions = requestOptions.retry === undefined ? options.retry : requestOptions.retry;
    const execute = () => postJson<T>(fetcher, url, body, {
      headers: { ...options.headers, ...requestOptions.headers },
      requestTimeoutMs,
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(requestOptions.signal ? { signal: requestOptions.signal } : {})
    });
    if (retryOptions === false || retryOptions === undefined) return execute();
    return withRetry(execute, {
      ...retryOptions,
      ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
      shouldRetry: async (error, attempt) => {
        if (!isOpenAICompatibleError(error) || !error.retryable) return false;
        return retryOptions?.shouldRetry ? retryOptions.shouldRetry(error, attempt) : true;
      }
    });
  }

  return {
    request,
    createChatCompletion: <T = Record<string, unknown>>(body: Record<string, unknown>, requestOptions?: OpenAICompatibleRequestOptions) => request<T>("chat/completions", body, requestOptions),
    createImage: <T = Record<string, unknown>>(body: Record<string, unknown>, requestOptions?: OpenAICompatibleRequestOptions) => request<T>("images/generations", body, requestOptions)
  };
}

async function postJson<T>(fetcher: typeof fetch, url: string, body: Record<string, unknown>, options: { apiKey?: string; headers: Record<string, string>; requestTimeoutMs: number; signal?: AbortSignal }): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(options.requestTimeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
  if (options.apiKey?.trim()) headers.authorization = `Bearer ${options.apiKey.trim()}`;

  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (cause) {
    if (options.signal?.aborted) throw new OpenAICompatibleError("REQUEST_ABORTED", "OpenAI-compatible request aborted", { cause });
    throw new OpenAICompatibleError("REQUEST_FAILED", "OpenAI-compatible request failed", { retryable: true, cause });
  }

  const text = await response.text();
  const requestId = response.headers.get("x-request-id") || undefined;
  if (!response.ok) {
    const message = extractErrorMessage(text) || `OpenAI-compatible request failed ${response.status}`;
    throw new OpenAICompatibleError("REQUEST_FAILED", message, {
      status: response.status,
      retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      ...(requestId ? { requestId } : {})
    });
  }

  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch (cause) {
    throw new OpenAICompatibleError("INVALID_RESPONSE", "OpenAI-compatible endpoint returned invalid JSON", { ...(requestId ? { requestId } : {}), cause });
  }
}

function normalizeBaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString().replace(/\/+$/, "") + "/";
  } catch (cause) {
    throw new OpenAICompatibleError("INVALID_CONFIGURATION", "OpenAI-compatible baseUrl must be an HTTP(S) URL", { cause });
  }
}

function resolveEndpoint(baseUrl: string, path: string) {
  const relative = String(path || "").trim().replace(/^\/+/, "");
  if (!relative) throw new OpenAICompatibleError("INVALID_CONFIGURATION", "OpenAI-compatible request path is required");
  return new URL(relative, baseUrl).toString();
}

function normalizeTimeout(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(10 * 60_000, Math.round(value as number)));
}

function extractErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const value = parsed.error?.message ?? parsed.message;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return text.trim().slice(0, 500);
  }
}
