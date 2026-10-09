import type { ModelCapabilityTag, ProviderProtocol } from "./types.js";
import type { ModelRecord, ModelTestResult, ModelTestState, ProviderRecord } from "./types.js";
import { providerModelHeaders, normalizeProviderProtocol, inferModelCapabilityTags } from "./protocol-catalog.js";
import { normalizeModelCapabilityTags, normalizeModelTestState, parseAdvancedConfig } from "./model-normalize.js";
import { parseUpstreamJson, looksLikeHtml, safeText } from "../util.js";
import type { SecretCodec } from "../crypto.js";

const TEST_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const TEST_AUDIO_DATA_URL =
  "data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export interface ModelTestOptions {
  fetcher?: typeof fetch;
  /**
   * Generation-capability tests spend real upstream credits. They only run when
   * the caller explicitly confirms the cost (the admin UI should surface this);
   * otherwise the response explains how to enable them.
   */
  confirmCost?: boolean;
}

export interface WiredModelTestOptions extends ModelTestOptions {
  codec: SecretCodec;
}

type ModelTestStateKey = keyof ModelTestState;

export async function testModelConnectivity(provider: ProviderRecord, model: ModelRecord, rawKind: string, options: WiredModelTestOptions): Promise<{
  stateKey: ModelTestStateKey;
  test: ModelTestResult;
}> {
  const kind = normalizeModelTestKind(rawKind);
  const startedAt = Date.now();
  const fail = (message: string, status = 0, inferredTags: ModelCapabilityTag[] = []): { stateKey: ModelTestStateKey; test: ModelTestResult } => ({
    stateKey: kind.stateKey,
    test: {
      ok: false,
      status,
      message,
      checkedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      inferredTags
    }
  });
  const apiKey = providerPlainApiKey(provider, options.codec);
  if (!apiKey) return fail("Provider 未配置 API Key");
  const protocol = normalizeProviderProtocol(model.protocolOverride || provider.protocol);
  if (!["openai", "apimart", "modelscope", "custom"].includes(protocol)) {
    return fail(`当前模型测试暂未接入 ${protocol} 协议`);
  }
  const capabilityTags = normalizeModelCapabilityTags(model.capabilityTags, model.capability, model.modelId);
  if (kind.stateKey === "videoUnderstanding") {
    if (!capabilityTags.includes("video_understanding")) {
      return fail("模型未标记为视频理解模型；请先手动开启视频理解标签，或使用图像关键帧测试。", 0, ["video_understanding"]);
    }
    return fail("视频理解真实样本测试需要固定测试视频，本期先记录能力标签，不自动消耗视频测试。", 0, ["video_understanding"]);
  }
  if (kind.stateKey === "imageGeneration" || kind.stateKey === "videoGeneration") {
    if (!options.confirmCost) {
      return fail("生成类模型测试会产生上游费用；如需执行，请勾选“确认产生费用”后重试。");
    }
  }
  if (kind.stateKey === "audioGeneration" || kind.stateKey === "voiceClone") {
    return testAudioModel(provider, model, protocol, apiKey, kind.stateKey, startedAt, fail, options);
  }
  try {
    const messages = kind.stateKey === "imageUnderstanding"
      ? [{
          role: "user",
          content: [
            { type: "text", text: "请用一句中文说明你是否能看到这张测试图片。" },
            { type: "image_url", image_url: { url: TEST_IMAGE_DATA_URL } }
          ]
        }]
      : [{ role: "user", content: "请只回答：连接正常" }];
    const generated = kind.stateKey === "imageGeneration"
      ? await callOpenAiGeneration(provider, model, protocol, apiKey, options)
      : await callOpenAiChat(provider, apiKey, protocol, model, messages, options);
    if (generated.error) return fail(generated.error, generated.status);
    const raw = generated.raw;
    if (kind.stateKey === "imageGeneration") {
      const outputs = raw?.data;
      const urls: string[] = [];
      for (const item of Array.isArray(outputs) ? outputs : []) {
        const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const url = safeText(row.url || row.image_url);
        const base64 = safeText(row.b64_json);
        if (url) urls.push(url);
        else if (base64) urls.push(toImageDataUrl(base64));
      }
      if (urls.length === 0) return fail("上游返回成功但没有图像内容", generated.status);
      return succeed(kind.stateKey, generated.status, startedAt, "图像生成测试请求成功（已产生少量上游费用）", ["image_generation"], `${urls.length} 张图像`);
    }
    const content = extractChatContent(raw);
    if (!content.trim()) return fail("上游返回成功但没有文本内容", generated.status);
    const inferredTags = kind.stateKey === "imageUnderstanding"
      ? ["image_understanding" as ModelCapabilityTag]
      : ["text_chat" as ModelCapabilityTag];
    return succeed(
      kind.stateKey,
      generated.status,
      startedAt,
      kind.stateKey === "imageUnderstanding" ? "图像理解测试请求成功" : "文本对话测试请求成功",
      inferredTags,
      content.slice(0, 240)
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300));
  }
}

function testAudioModel(
  provider: ProviderRecord,
  model: ModelRecord,
  protocol: ProviderProtocol,
  apiKey: string,
  stateKey: ModelTestStateKey,
  startedAt: number,
  fail: (message: string, status?: number, tags?: ModelCapabilityTag[]) => { stateKey: ModelTestStateKey; test: ModelTestResult },
  options: WiredModelTestOptions,
) {
  return (async () => {
    const advancedConfig = parseAdvancedConfig(model.advancedConfig);
    const mode = stateKey === "voiceClone" ? "voice_clone" : "tts";
    const tags: ModelCapabilityTag[] = mode === "voice_clone" ? ["voice_clone"] : ["tts"];
    const capabilityTags = normalizeModelCapabilityTags(model.capabilityTags, model.capability, model.modelId);
    if (mode === "voice_clone" && !capabilityTags.includes("voice_clone")) {
      return fail("模型未标记为音色克隆模型；请先开启 voice_clone 标签。", 0, ["voice_clone"]);
    }
    try {
      const audio: Record<string, unknown> = { format: safeText(advancedConfig.audioFormat, "wav") };
      if (mode === "voice_clone") audio.voice = TEST_AUDIO_DATA_URL;
      else audio.voice = safeText(advancedConfig.voice, "mimo_default");
      const payload = {
        model: model.modelId,
        messages: [
          { role: "user", content: mode === "voice_clone" ? "尽量保留原始音色，清晰播报。" : "自然、清晰、稳定地播报。" },
          { role: "assistant", content: mode === "voice_clone" ? "请复刻参考音色并播报：中控音色克隆测试。" : "中控语音链路测试。" }
        ],
        audio
      };
      const upstream = await (options.fetcher ?? fetch)(openAiEndpoint(provider.baseUrl, safeText(advancedConfig.submitPath, "chat/completions")), {
        method: "POST",
        headers: { ...providerModelHeaders(apiKey, protocol), "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000)
      });
      const text = await upstream.text();
      if (looksLikeHtml(text)) return fail("上游返回网页 HTML，请检查 Base URL 是否为 API 地址", upstream.status);
      if (!upstream.ok) return fail(`上游音频请求失败 ${upstream.status}: ${text.slice(0, 300)}`, upstream.status);
      const raw = parseUpstreamJson(text, "音频模型测试接口", upstream.headers.get("content-type") || "") as Record<string, unknown>;
      const audioRefs = collectAudioRefs(raw);
      const audioCount = audioRefs.length;
      if (audioCount === 0) return fail("上游返回成功但没有音频内容", upstream.status);
      return {
        stateKey,
        test: {
          ok: true,
          status: upstream.status,
          message: mode === "voice_clone" ? "音色克隆测试请求成功" : "语音生成测试请求成功",
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          inferredTags: tags,
          sampleOutput: `${audioCount} 段音频已返回`
        }
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300), 0, tags);
    }
  })();
}

async function callOpenAiChat(
  provider: ProviderRecord,
  apiKey: string,
  protocol: ProviderProtocol,
  model: ModelRecord,
  messages: unknown,
  options: WiredModelTestOptions,
): Promise<{ raw?: Record<string, unknown>; status: number; error?: string }> {
  const upstream = await (options.fetcher ?? fetch)(openAiEndpoint(provider.baseUrl, "chat/completions"), {
    method: "POST",
    headers: { ...providerModelHeaders(apiKey, protocol), "content-type": "application/json" },
    body: JSON.stringify({ model: model.modelId, messages, stream: false, max_tokens: 64 }),
    signal: AbortSignal.timeout(45000)
  });
  const text = await upstream.text();
  if (looksLikeHtml(text)) return { status: upstream.status, error: "上游返回网页 HTML，请检查 Base URL 是否为 API 地址" };
  if (!upstream.ok) return { status: upstream.status, error: `上游请求失败 ${upstream.status}: ${text.slice(0, 300)}` };
  const raw = parseUpstreamJson(text, "文本对话测试接口", upstream.headers.get("content-type") || "") as Record<string, unknown>;
  return { raw, status: upstream.status };
}

async function callOpenAiGeneration(
  provider: ProviderRecord,
  model: ModelRecord,
  protocol: ProviderProtocol,
  apiKey: string,
  options: WiredModelTestOptions,
): Promise<{ raw?: Record<string, unknown>; status: number; error?: string }> {
  const payload = {
    model: model.modelId,
    prompt: "A tiny🕹 smoke test image of a single blue square on white background",
    n: 1,
    size: "256x256"
  };
  const upstream = await (options.fetcher ?? fetch)(openAiEndpoint(provider.baseUrl, "images/generations"), {
    method: "POST",
    headers: { ...providerModelHeaders(apiKey, protocol), "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000)
  });
  const text = await upstream.text();
  if (looksLikeHtml(text)) return { status: upstream.status, error: "上游返回网页 HTML，请检查 Base URL 是否为 API 地址" };
  if (!upstream.ok) return { status: upstream.status, error: `上游图像生成失败 ${upstream.status}: ${text.slice(0, 300)}` };
  const raw = parseUpstreamJson(text, "图像生成接口", upstream.headers.get("content-type") || "") as Record<string, unknown>;
  return { raw, status: upstream.status };
}

function succeed(
  stateKey: ModelTestStateKey,
  status: number,
  startedAt: number,
  message: string,
  inferredTags: ModelCapabilityTag[],
  sampleOutput: string,
): { stateKey: ModelTestStateKey; test: ModelTestResult } {
  return {
    stateKey,
    test: {
      ok: true,
      status,
      message,
      checkedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      inferredTags,
      sampleOutput
    }
  };
}

export function normalizeModelTestKind(kind: string): { stateKey: ModelTestStateKey } {
  const value = kind.trim();
  if (value === "image_understanding") return { stateKey: "imageUnderstanding" };
  if (value === "video_understanding") return { stateKey: "videoUnderstanding" };
  if (value === "image_generation") return { stateKey: "imageGeneration" };
  if (value === "video_generation") return { stateKey: "videoGeneration" };
  if (value === "audio_generation" || value === "tts") return { stateKey: "audioGeneration" };
  if (value === "voice_clone") return { stateKey: "voiceClone" };
  return { stateKey: "chat" };
}

export function providerPlainApiKey(provider: Partial<ProviderRecord> & { apiKey?: string | undefined }, codec: SecretCodec) {
  const explicit = String(provider.apiKey || "").trim();
  if (explicit && !explicit.startsWith("enc:v1:")) return explicit;
  return codec.decrypt(provider.apiKey || "");
}

export function openAiEndpoint(baseUrlValue: unknown, pathname: string) {
  const baseUrl = safeText(baseUrlValue).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("Provider 请求地址必须以 http:// 或 https:// 开头");
  const normalizedPathname = safeText(pathname);
  if (/^https?:\/\//i.test(normalizedPathname)) return normalizedPathname;
  if (normalizedPathname.startsWith("../") || normalizedPathname.startsWith("./")) {
    return new URL(normalizedPathname, `${baseUrl}/`).toString();
  }
  return baseUrl.endsWith("/v1") ? `${baseUrl}/${normalizedPathname}` : `${baseUrl}/v1/${normalizedPathname}`;
}

function collectAudioRefs(raw: unknown): string[] {
  const candidates = [
    readStringAtPath(raw, "choices.0.message.audio.data"),
    readStringAtPath(raw, "choices.0.message.audio.url"),
    readStringAtPath(raw, "audio.data"),
    readStringAtPath(raw, "audio.url"),
    readStringAtPath(raw, "data.audio"),
    readStringAtPath(raw, "data.url"),
    readStringAtPath(raw, "url")
  ].filter(Boolean);
  const out: string[] = [];
  for (const item of candidates) {
    if (/^data:audio\//i.test(item)) out.push(item);
    else if (/^https?:\/\//i.test(item)) out.push(item);
  }
  return [...new Set(out)];
}

function readStringAtPath(source: unknown, path: string): string {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) return "";
    if (/^\d+$/.test(part)) {
      if (!Array.isArray(current)) return "";
      current = current[Number(part)];
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else return "";
  }
  return typeof current === "string" ? current : "";
}

function extractChatContent(raw: Record<string, unknown> | undefined) {
  if (!raw) return "";
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  const content = message.content ?? first.text ?? raw.output_text ?? raw.text ?? raw.content ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown> | string>)
      .map((item) => typeof item === "string" ? item : safeText(item?.text || item?.content))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function toImageDataUrl(value: string) {
  if (/^data:image\//i.test(value)) return value;
  return `data:image/png;base64,${value.replace(/\s+/g, "")}`;
}

export { inferModelCapabilityTags, normalizeModelTestState };
