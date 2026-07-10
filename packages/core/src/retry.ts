export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
  onRetry?: (context: RetryContext) => void | Promise<void>;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = clampInteger(options.maxAttempts, 1, 10, 3);
  const baseDelayMs = clampInteger(options.baseDelayMs, 0, 60_000, 500);
  const maxDelayMs = clampInteger(options.maxDelayMs, baseDelayMs, 5 * 60_000, 10_000);
  const factor = clampNumber(options.factor, 1, 10, 2);
  const jitter = clampNumber(options.jitter, 0, 1, 0.2);
  const random = options.random ?? Math.random;
  const wait = options.wait ?? waitFor;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !(await (options.shouldRetry?.(error, attempt) ?? true))) throw error;
      const exponential = Math.min(maxDelayMs, baseDelayMs * factor ** (attempt - 1));
      const spread = exponential * jitter;
      const delayMs = Math.max(0, Math.round(exponential - spread + random() * spread * 2));
      await options.onRetry?.({ attempt, maxAttempts, delayMs, error });
      await wait(delayMs, options.signal);
    }
  }

  throw new Error("Retry loop exited unexpectedly");
}

async function waitFor(ms: number, signal?: AbortSignal) {
  if (ms <= 0) {
    throwIfAborted(signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value as number)));
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value as number));
}
