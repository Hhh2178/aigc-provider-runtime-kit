export function safeText(value: unknown, fallback = "", maxLength = 240) {
  const length = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 240;
  const text = String(value ?? "").trim().slice(0, length);
  return text || fallback;
}

export function safeLongText(value: unknown, fallback = "", maxLength = 16_000) {
  const length = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 16_000;
  return String(value ?? fallback).trim().slice(0, length);
}

export function safeSlug(value: unknown, fallback = "item") {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80) || fallback;
}

export function safeJsonText(value: unknown, fallback = "{}") {
  const text = String(value ?? fallback).trim() || fallback;
  try {
    JSON.parse(text);
    return text;
  } catch {
    return fallback;
  }
}

export function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function millisToDate(value: number | undefined) {
  return new Date(typeof value === "number" && Number.isFinite(value) ? value : Date.now());
}

export function dateToMillis(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();
  return Number.isFinite(time) ? time : Date.now();
}

export function looksLikeHtml(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    /^<!doctype html/i.test(normalized)
    || /^<html[\s>]/i.test(normalized)
    || /^<body[\s>]/i.test(normalized)
    || /^<head[\s>]/i.test(normalized)
    || normalized.includes("<html")
    || normalized.includes("just a moment")
    || normalized.includes("cf-browser-verification")
    || normalized.includes("attention required")
  );
}

export function summarizeUpstreamBody(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 320);
}

export function parseUpstreamJson(text: string, label: string, contentType?: string) {
  const normalized = String(text || "").trim();
  if (!normalized) return {};
  try {
    return JSON.parse(normalized);
  } catch {
    if (looksLikeHtml(normalized) || /text\/html|application\/xhtml\+xml/i.test(String(contentType || ""))) {
      throw new Error(`${label}返回网页 HTML，请检查 Base URL、Cloudflare/WAF 或上游鉴权`);
    }
    throw new Error(`${label}返回非 JSON 响应${contentType ? ` (${contentType})` : ""}: ${summarizeUpstreamBody(normalized)}`);
  }
}
