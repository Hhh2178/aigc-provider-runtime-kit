export function isMultipartRequestBodyMode(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "multipart" || normalized === "multipart_form_data" || normalized === "multipart/form-data";
}

export async function buildProviderMultipartRequestBody(payload: Record<string, unknown>, fileFieldNamesValue: unknown) {
  const form = new FormData();
  const fileFieldNames = new Set(normalizeStringList(fileFieldNamesValue));
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (fileFieldNames.has(key)) {
      await appendMultipartFileField(form, key, value);
      continue;
    }
    appendScalarField(form, key, value);
  }
  return form;
}

async function appendMultipartFileField(form: FormData, field: string, value: unknown) {
  const entries = Array.isArray(value) ? value : [value];
  let ordinal = 0;
  for (const entry of entries) {
    const source = String(entry || "").trim();
    if (!source) continue;
    ordinal += 1;
    const file = await readMultipartFile(source, field, ordinal);
    form.append(field, file.blob, file.filename);
  }
}

async function readMultipartFile(source: string, field: string, ordinal: number) {
  if (/^data:/i.test(source)) return dataUrlFile(source, field, ordinal);
  const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Asset download failed ${response.status}: ${source}`);
  const mime = safeMimeType(response.headers.get("content-type")) || "application/octet-stream";
  const blob = new Blob([await response.arrayBuffer()], { type: mime });
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
