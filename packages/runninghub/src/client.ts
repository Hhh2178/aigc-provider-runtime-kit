export interface RunningHubClientOptions {
  apiKey: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

export interface RunningHubNodeInfoItem {
  nodeId: string;
  fieldName: string;
  fieldValue: unknown;
}

export interface RunningHubRunInput {
  targetType: "app" | "workflow";
  runTargetId: string;
  appId?: string;
  workflowId?: string;
  nodeInfoList: RunningHubNodeInfoItem[];
  instanceType?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onHeartbeat?: (patch: Record<string, unknown>) => void | Promise<void>;
}

export interface RunningHubRunResult {
  adapter: "runninghub";
  upstreamTaskId: string;
  rhTargetType: "app" | "workflow";
  rhRunTargetId: string;
  raw: Record<string, unknown>;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
}

export function createRunningHubClient(options: RunningHubClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms))));

  async function runTask(input: RunningHubRunInput): Promise<RunningHubRunResult> {
    const targetType = input.targetType;
    const runTargetId = safeText(input.runTargetId);
    if (!runTargetId) throw new Error(targetType === "app" ? "RunningHub app runTargetId is required" : "RunningHub workflow runTargetId is required");

    const baseUrl = options.baseUrl.replace(/\/+$/, "");
    const appId = safeText(input.appId || (targetType === "app" ? runTargetId : ""));
    const workflowId = safeText(input.workflowId || (targetType === "workflow" ? runTargetId : ""));
    const submitUrl = targetType === "app"
      ? `${baseUrl}/openapi/v2/run/ai-app/${encodeURIComponent(appId || runTargetId)}`
      : `${baseUrl}/openapi/v2/run/workflow/${encodeURIComponent(workflowId || runTargetId)}`;
    const queryUrl = `${baseUrl}/openapi/v2/query`;

    const submitBody = targetType === "app"
      ? {
          nodeInfoList: input.nodeInfoList,
          ...(safeText(input.instanceType) ? { instanceType: safeText(input.instanceType) } : {}),
          usePersonalQueue: "false"
        }
      : {
          apiKey: options.apiKey,
          workflowId: workflowId || runTargetId,
          nodeInfoList: input.nodeInfoList,
          ...(safeText(input.instanceType) ? { instanceType: safeText(input.instanceType) } : {})
        };

    const submitRaw = await postJson(fetcher, submitUrl, options.apiKey, submitBody, "submit");
    const submitData = plainObject(targetType === "app" ? plainObject(submitRaw.data) : submitRaw.data);
    const upstreamTaskId = safeText(submitData.taskId || submitData.id || submitRaw.taskId || submitRaw.id);
    const upstreamCode = Number(submitRaw.code);
    if ((Number.isFinite(upstreamCode) && upstreamCode !== 0) || !upstreamTaskId) {
      throw new Error(safeText(submitData.msg || submitRaw.message || submitRaw.msg, "RunningHub did not return a valid task id"));
    }

    await input.onHeartbeat?.({
      upstreamTaskId,
      upstreamStatus: "submitted",
      progress: "5%",
      rhTargetType: targetType,
      rhRunTargetId: runTargetId
    });

    const startedAt = Date.now();
    const interval = Math.max(1000, Number(input.pollIntervalMs || 5000));
    for (;;) {
      if (input.timeoutMs && Date.now() - startedAt > input.timeoutMs) {
        throw new Error(`RunningHub poll timeout: ${upstreamTaskId}`);
      }
      await wait(interval);
      const pollRaw = await postJson(fetcher, queryUrl, options.apiKey, { taskId: upstreamTaskId }, "poll");
      const status = safeText(pollRaw.status || plainObject(pollRaw.data).status).toUpperCase();
      const message = safeText(pollRaw.errorMessage || pollRaw.msg || pollRaw.message || plainObject(pollRaw.data).message);
      await input.onHeartbeat?.({
        upstreamTaskId,
        upstreamStatus: status,
        upstreamMessage: message,
        progress: ["QUEUED", "PENDING", "WAITING"].includes(status) ? "5%" : "45%",
        rhTargetType: targetType,
        rhRunTargetId: runTargetId
      });

      if (["RUNNING", "PENDING", "QUEUED", "WAITING"].includes(status)) continue;
      if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status)) {
        throw new Error(message || `RunningHub task failed: ${upstreamTaskId}`);
      }

      const urls = extractRunningHubOutputUrls(targetType === "app" ? pollRaw.results || pollRaw.data || pollRaw : pollRaw.data || pollRaw);
      if (urls.imageUrls.length === 0 && urls.videoUrls.length === 0 && urls.audioUrls.length === 0) {
        throw new Error(message || "RunningHub task completed without usable outputs");
      }
      return {
        adapter: "runninghub",
        upstreamTaskId,
        rhTargetType: targetType,
        rhRunTargetId: runTargetId,
        raw: pollRaw,
        ...urls
      };
    }
  }

  return { runTask };
}

async function postJson(fetcher: typeof fetch, url: string, apiKey: string, body: Record<string, unknown>, stage: string) {
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`RunningHub ${stage} failed ${response.status}: ${text.slice(0, 500)}`);
  try {
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    throw new Error(`RunningHub ${stage} returned invalid JSON`);
  }
}

export function extractRunningHubOutputUrls(value: unknown) {
  const urls = collectRunningHubUrls(value);
  const imageUrls = urls.filter((url) => /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i.test(url));
  const videoUrls = urls.filter((url) => /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(url));
  const audioUrls = urls.filter((url) => /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(url));
  const uncategorized = urls.filter((url) => !imageUrls.includes(url) && !videoUrls.includes(url) && !audioUrls.includes(url));
  if (imageUrls.length === 0 && videoUrls.length === 0 && audioUrls.length === 0) videoUrls.push(...uncategorized);
  return { imageUrls, videoUrls, audioUrls };
}

function collectRunningHubUrls(value: unknown, seen = new Set<string>()): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^https?:\/\//i.test(text) || seen.has(text)) return [];
    seen.add(text);
    return [text];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectRunningHubUrls(item, seen));
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return [
      ...collectRunningHubUrls(row.fileUrl, seen),
      ...collectRunningHubUrls(row.url, seen),
      ...collectRunningHubUrls(row.downloadUrl, seen),
      ...collectRunningHubUrls(row.previewUrl, seen),
      ...collectRunningHubUrls(row.outputs, seen),
      ...collectRunningHubUrls(row.results, seen),
      ...collectRunningHubUrls(row.files, seen),
      ...collectRunningHubUrls(row.data, seen),
      ...collectRunningHubUrls(row.result, seen)
    ];
  }
  return [];
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeText(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}
