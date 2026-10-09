import type { ProviderRecord } from "./types.js";
import { providerModelHeaders, providerModelsUrl, normalizeProviderProtocol, parseUpstreamModels, inferModelCapabilityTags } from "./protocol-catalog.js";
import { parseUpstreamJson, looksLikeHtml, safeText } from "../util.js";
import { providerPlainApiKey } from "./provider-test.js";
import type { SecretCodec } from "../crypto.js";

export interface ProviderProbeResult {
  ok: boolean;
  status: number;
  message: string;
  modelCount: number;
  all: string[];
  chatModels: string[];
  imageModels: string[];
  videoModels: string[];
  audioModels: string[];
  modelTags: Record<string, string[]>;
}

const EMPTY_PROBE: ProviderProbeResult = {
  ok: false, status: 0, message: "", modelCount: 0,
  all: [], chatModels: [], imageModels: [], videoModels: [], audioModels: [], modelTags: {}
};

function emptyProbe(message: string, status = 0): ProviderProbeResult {
  return { ...EMPTY_PROBE, ok: false, status, message };
}

export interface ProbeOptions {
  fetcher?: typeof fetch;
  codec: SecretCodec;
}

export async function probeProvider(provider: Partial<ProviderRecord> & { apiKey?: string | undefined }, options: ProbeOptions): Promise<ProviderProbeResult> {
  const fetcher = options.fetcher ?? fetch;
  if (isGrsaiProvider(provider)) {
    const baseUrl = safeText(provider.baseUrl).replace(/\/+$/, "");
    if (!baseUrl) return emptyProbe("请先填写请求地址");
    if (!/^https?:\/\//i.test(baseUrl)) return emptyProbe("请求地址必须以 http:// 或 https:// 开头");
    if (!providerPlainApiKey(provider, options.codec)) return emptyProbe("请先填写或保存 API Key");
    return {
      ok: true,
      status: 200,
      message: "GRSAI Draw 使用手动模型目录，不支持自动拉取模型列表",
      modelCount: 1,
      all: ["gpt-image-2"],
      chatModels: [],
      imageModels: ["gpt-image-2"],
      videoModels: [],
      audioModels: [],
      modelTags: { "gpt-image-2": inferModelCapabilityTags("gpt-image-2", "image") }
    };
  }
  const protocol = normalizeProviderProtocol(provider.protocol);
  const url = providerModelsUrl(provider.baseUrl, protocol);
  if (!url) return emptyProbe("请先填写请求地址");
  if (!/^https?:\/\//i.test(url)) return emptyProbe("请求地址必须以 http:// 或 https:// 开头");
  const apiKey = providerPlainApiKey(provider, options.codec);
  if (!apiKey) return emptyProbe("请先填写或保存 API Key");
  try {
    const upstream = await fetcher(url, { headers: providerModelHeaders(apiKey, protocol), signal: AbortSignal.timeout(15000) });
    const text = await upstream.text();
    if (looksLikeHtml(text)) return emptyProbe("上游返回网页 HTML，请检查 Base URL 是否为 API 地址", upstream.status);
    if (!upstream.ok) return emptyProbe(text.slice(0, 300), upstream.status);
    const raw = parseUpstreamJson(text, "模型列表探测接口", upstream.headers.get("content-type") || "");
    const parsed = parseUpstreamModels(raw, protocol);
    return {
      ok: true,
      status: upstream.status,
      message: parsed.total ? `地址验证通过，找到 ${parsed.total} 个模型` : "地址验证通过，但未返回模型列表",
      modelCount: parsed.total,
      all: parsed.all,
      chatModels: parsed.chatModels,
      imageModels: parsed.imageModels,
      videoModels: parsed.videoModels,
      audioModels: parsed.audioModels,
      modelTags: parsed.modelTags
    };
  } catch (error) {
    return emptyProbe(error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300));
  }
}

export async function fetchProviderModels(provider: Partial<ProviderRecord> & { apiKey?: string | undefined }, options: ProbeOptions): Promise<ProviderProbeResult & { total: number }> {
  const result = await probeProvider(provider, options);
  return { ...result, total: result.modelCount };
}

export function isGrsaiProvider(provider: Partial<ProviderRecord> & { apiKey?: string | undefined }) {
  const protocol = normalizeProviderProtocol(provider.protocol);
  if (protocol === "grsai_draw") return true;
  const id = safeText(provider.id).toLowerCase();
  const name = safeText(provider.name).toLowerCase();
  const baseUrl = safeText(provider.baseUrl).toLowerCase();
  return [id, name, baseUrl].some((value) => value.includes("grsai") || value.includes("grsai.dakka.com.cn"));
}
