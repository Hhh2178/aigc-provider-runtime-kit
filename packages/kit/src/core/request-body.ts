const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

export interface BodyReadOptions {
  /** Upper bound for a single upstream body. Defaults to 64 MiB. */
  maxBytes?: number;
}

/**
 * Reads an upstream response body as text with a hard byte cap so a large or
 * hostile upstream cannot exhaust the Node heap. Aborts the stream once the cap
 * is exceeded.
 */
export async function readResponseBodyText(response: Response, options: BodyReadOptions = {}): Promise<string> {
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for await (const chunk of streamResponseBody(response, maxBytes)) chunks.push(chunk);
  const decoder = new TextDecoder();
  let text = "";
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return text;
}

/**
 * Reads an upstream response body as raw bytes with the same hard byte cap.
 */
export async function readResponseBodyBytes(response: Response, options: BodyReadOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for await (const chunk of streamResponseBody(response, maxBytes)) {
    chunks.push(chunk);
    received += chunk.byteLength;
  }
  const merged = new Uint8Array(new ArrayBuffer(received));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function normalizeMaxBytes(maxBytesValue?: number) {
  const value = Number(maxBytesValue);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_BODY_BYTES;
  return Math.max(1024, Math.floor(value));
}

async function* streamResponseBody(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Upstream response body exceeds ${maxBytes} bytes (content-length ${contentLength})`);
  }
  const body = response.body;
  if (!body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error(`Upstream response body exceeds ${maxBytes} bytes`);
    yield new Uint8Array(buffer);
    return;
  }
  const reader = body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const chunk = (value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)) as Uint8Array<ArrayBuffer>;
      received += chunk.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new Error(`Upstream response body exceeds ${maxBytes} bytes`);
      }
      yield chunk;
    }
  } finally {
    void reader.releaseLock?.();
  }
}

export function isMultipartRequestBodyMode(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "multipart" || normalized === "multipart_form_data" || normalized === "multipart/form-data";
}

export async function buildProviderMultipartRequestBody(payload: Record<string, unknown>, fileFieldNamesValue: unknown, options: BodyReadOptions = {}) {
  const form = new FormData();
  const fileFieldNames = new Set(normalizeStringList(fileFieldNamesValue));
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (fileFieldNames.has(key)) {
      await appendMultipartFileField(form, key, value, options);
      continue;
    }
    appendScalarField(form, key, value);
  }
  return form;
}

async function appendMultipartFileField(form: FormData, field: string, value: unknown, options: BodyReadOptions) {
  const entries = Array.isArray(value) ? value : [value];
  let ordinal = 0;
  for (const entry of entries) {
    const source = String(entry || "").trim();
    if (!source) continue;
    ordinal += 1;
    const file = await readMultipartFile(source, field, ordinal, options);
    form.append(field, file.blob, file.filename);
  }
}

async function readMultipartFile(source: string, field: string, ordinal: number, options: BodyReadOptions) {
  if (/^data:/i.test(source)) return dataUrlFile(source, field, ordinal);
  const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Asset download failed ${response.status}: ${source}`);
  const mime = safeMimeType(response.headers.get("content-type")) || "application/octet-stream";
  const blob = new Blob([await readResponseBodyBytes(response, options)], { type: mime });
  return { blob, filename: inferFilename(source, mime, field, ordinal) };
}

function dataUrlFile(source: string, field: string, ordinal: number) {
  const match = source.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) throw new Error(`Unsupported data URL for field: ${field}`);
  const mime = safeMimeType(match[1] || "") || "application/octet-stream";
  const raw = match[3] || "";
  const bytes = match[2] ? base64ToBytes(raw) : new TextEncoder().encode(decodeURIComponent(raw));
  return {
    blob: new Blob([bytes], { type: mime }),
    filename: inferFilename("", mime, field, ordinal)
  };
}

function appendScalarField(form: FormData, field: string, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) appendScalarField(form, field, item);
    return;
  }
  if (typeof value === "string") {
    if (value.trim()) form.append(field, value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    form.append(field, String(value));
    return;
  }
  if (value && typeof value === "object") form.append(field, JSON.stringify(value));
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function safeMimeType(value: string | null) {
  return String(value || "").split(";")[0]?.trim().toLowerCase() || "";
}

function inferFilename(source: string, mime: string, field: string, ordinal: number) {
  const extension = extensionFromMime(mime);
  try {
    const url = new URL(source);
    const fromPath = decodeURIComponent(url.pathname.split("/").pop() || "").trim();
    if (fromPath && /\.[a-z0-9]{2,8}$/i.test(fromPath)) return fromPath;
  } catch {
    // Non-URL sources fall back to generated names.
  }
  return `${field}-${ordinal}.${extension}`;
}

function extensionFromMime(mime: string) {
  const lookup: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "application/octet-stream": "bin"
  };
  return lookup[mime] || "bin";
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
