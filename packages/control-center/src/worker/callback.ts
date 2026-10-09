/**
 * Terminal-state callback delivery for host applications.
 * Best-effort by design: a failed callback is recorded but never fails the task.
 */
import { safeText } from "../util.js";

export interface TaskCallbackBody {
  taskId: string;
  status: "succeeded" | "failed" | "cancelled";
  capability: string;
  providerId: string;
  modelRecordId?: string;
  result: Record<string, unknown>;
}

export interface CallbackDeliveryResult {
  attempted: boolean;
  delivered: boolean;
  status?: number;
  error?: string;
}

export async function deliverTaskCallback(
  callbackUrl: unknown,
  body: TaskCallbackBody,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {}
): Promise<CallbackDeliveryResult> {
  const url = safeText(callbackUrl);
  if (!url) return { attempted: false, delivered: false };
  if (!/^https?:\/\//i.test(url)) return { attempted: false, delivered: false, error: "callbackUrl 必须是 http(s) 地址" };
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : 10_000;
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return { attempted: true, delivered: false, status: response.status, error: `callback HTTP ${response.status}` };
    }
    return { attempted: true, delivered: true, status: response.status };
  } catch (error) {
    return {
      attempted: true,
      delivered: false,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
    };
  }
}
