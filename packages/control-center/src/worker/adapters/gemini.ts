/**
 * Gemini chat adapter ported from the production worker adapter
 * (`xinghuan/apps/worker/src/worker-gemini-chat-adapter.ts`).
 *
 * Scope note: the production adapter also uploads "native video" files from
 * the canvas user's output directory through the Gemini Files API. The control
 * center has no per-user file directory in phase 2, so that path fails with an
 * explicit error; inline image parts (data URLs) and text chat work as-is.
 */
import { safeText } from "../../util.js";

export interface GeminiChatInput {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: unknown[];
  temperature?: number;
  maxTokens?: number;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
}

export interface GeminiChatResult {
  adapter: "gemini-generate-content";
  content: string;
  text: string;
  finishReason: string;
}

export async function executeGeminiChat(input: GeminiChatInput): Promise<GeminiChatResult> {
  const fetcher = input.fetcher ?? fetch;
  const apiRoot = geminiApiRoot(input.baseUrl);
  const apiKey = safeText(input.apiKey);
  const modelId = safeText(input.modelId).replace(/^models\//, "");
  if (!apiKey) throw new Error("GEMINI_API_KEY_REQUIRED");
  if (!modelId) throw new Error("GEMINI_MODEL_REQUIRED");

  const requestBody = buildGenerateContentBody({ messages: input.messages, temperature: input.temperature, maxTokens: input.maxTokens });
  const response = await fetcher(`${apiRoot}/models/${encodeURIComponent(modelId)}:generateContent`, {
    method: "POST",
    headers: geminiJsonHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal: requestSignal(input.signal, 120_000)
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`GEMINI_GENERATE_FAILED:${response.status}:${responseText.slice(0, 300)}`);
  const raw = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};
  const candidate = objectValue(Array.isArray(raw.candidates) ? raw.candidates[0] : undefined);
  const content = objectValue(candidate.content);
  const text = (Array.isArray(content.parts) ? content.parts : [])
    .map((part) => safeText(objectValue(part).text))
    .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("GEMINI_GENERATE_EMPTY_CONTENT");
  return { adapter: "gemini-generate-content", content: text, text, finishReason: String(candidate.finishReason || "") };
}

export function buildGenerateContentBody(input: {
  messages: unknown[];
  temperature?: number | undefined;
  maxTokens?: number | undefined;
}) {
  const contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }> = [];
  const systemParts: Array<{ text: string }> = [];
  for (const rawMessage of Array.isArray(input.messages) ? input.messages : []) {
    const message = objectValue(rawMessage);
    const role = safeText(message.role, "user").toLowerCase();
    const parts = geminiParts(message.content);
    if (parts.length === 0) continue;
    if (role === "system") {
      systemParts.push(...parts.flatMap((part) => typeof part.text === "string" ? [{ text: part.text }] : []));
      continue;
    }
    contents.push({ role: role === "assistant" ? "model" : "user", parts });
  }
  if (contents.length === 0) contents.push({ role: "user", parts: [{ text: "Analyze the provided media." }] });
  const generationConfig: Record<string, unknown> = {};
  if (Number.isFinite(input.temperature)) generationConfig.temperature = Math.max(0, Math.min(2, Number(input.temperature)));
  if (Number.isFinite(input.maxTokens) && Number(input.maxTokens) > 0) {
    generationConfig.maxOutputTokens = Math.min(200_000, Math.floor(Number(input.maxTokens)));
  }
  return {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {})
  };
}

export function geminiApiRoot(baseUrl: string) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) throw new Error("GEMINI_BASE_URL_INVALID");
  return normalized.endsWith("/v1beta") ? normalized : `${normalized}/v1beta`;
}

export function geminiParts(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return content.trim() ? [{ text: content.trim() }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((rawPart): Array<Record<string, unknown>> => {
    const part = objectValue(rawPart);
    if (part.type === "text" && safeText(part.text)) return [{ text: safeText(part.text) }];
    const imageUrl = objectValue(part.image_url).url;
    if (part.type === "image_url" && typeof imageUrl === "string") {
      const match = imageUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
      if (!match) throw new Error("GEMINI_IMAGE_INPUT_UNSUPPORTED");
      return [{ inline_data: { mime_type: (match[1] ?? "image/png").toLowerCase(), data: match[2] ?? "" } }];
    }
    return [];
  });
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  if (signal?.aborted) throw new Error("GEMINI_TASK_CANCELLED");
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function geminiJsonHeaders(apiKey: string) {
  return { "x-goog-api-key": apiKey, accept: "application/json", "content-type": "application/json" };
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
