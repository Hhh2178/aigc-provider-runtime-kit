import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { safeText } from "../util.js";

const MEDIA_BUCKETS = [
  { source: "imageUrls", target: "materializedImageUrls", fallbackMime: "image" },
  { source: "videoUrls", target: "materializedVideoUrls", fallbackMime: "video" },
  { source: "audioUrls", target: "materializedAudioUrls", fallbackMime: "audio" }
] as const;

export interface MaterializeOptions {
  storageDir: string;
  taskId: string;
  fetcher?: typeof fetch;
  /** Hard per-file cap (default 512 MiB — videos dominate). */
  maxBytes?: number;
}

export interface MaterializeOutcome {
  result: Record<string, unknown>;
  downloaded: Array<{ url: string; path: string }>;
  warnings: string[];
}

/**
 * Downloads remote outputs to the host-managed storage directory and records
 * `/api/tasks/{taskId}/files/{name}` URLs in `materialized*Urls`, mirroring the
 * production worker's `materialized*` result contract. Data URLs and failed
 * downloads keep their remote/original entries (best-effort, never fails the
 * task).
 */
export async function materializeTaskOutputs(result: Record<string, unknown>, options: MaterializeOptions): Promise<MaterializeOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const maxBytes = Number.isFinite(Number(options.maxBytes)) && Number(options.maxBytes) > 0
    ? Math.floor(Number(options.maxBytes))
    : 512 * 1024 * 1024;
  const taskDir = join(options.storageDir, sanitizeSegment(options.taskId));
  const merged: Record<string, unknown> = { ...result };
  const downloaded: Array<{ url: string; path: string }> = [];
  const warnings: string[] = [];

  for (const bucket of MEDIA_BUCKETS) {
    const urls = Array.isArray(result[bucket.source]) ? (result[bucket.source] as unknown[]).filter((item): item is string => typeof item === "string") : [];
    if (urls.length === 0) continue;
    const materialized: string[] = [];
    let index = 0;
    for (const url of urls) {
      index += 1;
      if (/^data:/i.test(url)) {
        materialized.push(url);
        continue;
      }
      if (!/^https?:\/\//i.test(url)) {
        materialized.push(url);
        continue;
      }
      try {
        const localPath = await downloadToFile(fetcher, url, taskDir, index, maxBytes);
        downloaded.push({ url, path: localPath });
        materialized.push(fileUrlFor(options.taskId, basenameOf(localPath)));
      } catch (error) {
        warnings.push(`物化失败（保留远程地址）${url.slice(0, 120)}: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`);
      }
    }
    if (materialized.length > 0) merged[bucket.target] = materialized;
  }

  return { result: merged, downloaded, warnings };
}

/** Resolves a served file path, rejecting traversal outside the task dir. */
export function resolveServedFile(storageDir: string, taskId: string, filename: string): string | null {
  const safeTask = sanitizeSegment(taskId);
  const safeName = sanitizeSegment(filename);
  if (!safeTask || !safeName || safeName.includes("..")) return null;
  const root = resolve(storageDir);
  const candidate = resolve(root, safeTask, safeName);
  if (!candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}

async function downloadToFile(fetcher: typeof fetch, url: string, taskDir: string, index: number, maxBytes: number): Promise<string> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`文件超过上限 ${maxBytes} 字节`);
  await mkdir(taskDir, { recursive: true });
  const name = `${index}-${filenameFromUrl(url)}`;
  const target = join(taskDir, name);
  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error(`文件超过上限 ${maxBytes} 字节`);
    await writeFile(target, buffer);
    return target;
  }
  const writer = createWriteStream(target);
  let received = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new Error(`文件超过上限 ${maxBytes} 字节`);
      }
      if (!writer.write(Buffer.from(value))) {
        await new Promise<void>((r) => writer.once("drain", () => r()));
      }
    }
    await new Promise<void>((resolveWrite, rejectWrite) => {
      writer.once("error", rejectWrite);
      writer.end(() => resolveWrite());
    });
  } catch (error) {
    writer.destroy();
    await rm(target, { force: true }).catch(() => {});
    throw error;
  }
  const info = await stat(target).catch(() => null);
  if (!info || info.size === 0) throw new Error("下载内容为空");
  return target;
}

function writeFile(target: string, buffer: Buffer) {
  return new Promise<void>((resolvePromise, reject) => {
    const writer = createWriteStream(target);
    writer.end(buffer, () => resolvePromise());
    writer.on("error", reject);
  });
}

function fileUrlFor(taskId: string, filename: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(filename)}`;
}

function filenameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const base = decodeURIComponent(pathname.split("/").pop() || "");
    if (base && /\.[a-z0-9]{1,8}$/i.test(base)) return sanitizeSegment(base);
  } catch {
    // fall through to generated name
  }
  return `file.bin`;
}

export function basenameOf(path: string) {
  return path.split(/[\\/]/).pop() || "file.bin";
}

export function mimeTypeFor(filename: string) {
  const ext = extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8"
  };
  return map[ext] || "application/octet-stream";
}

function sanitizeSegment(value: unknown) {
  return safeText(value, "", 200).replace(/[^a-zA-Z0-9._-]/g, "_");
}

