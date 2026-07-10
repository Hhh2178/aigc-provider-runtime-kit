import type { ProviderDefinition, ProviderModelDefinition, ProviderProtocol } from "./types.js";

export interface ValidationIssue {
  path: string;
  code: "required" | "invalid" | "duplicate" | "unknown_provider" | "out_of_range" | "unsupported";
  message: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  issues: ValidationIssue[];
}

export interface ProviderRegistryInput {
  providers: ProviderDefinition[];
  models?: ProviderModelDefinition[];
}

const PROVIDER_PROTOCOLS = new Set<ProviderProtocol>(["openai", "gemini", "runninghub", "volcengine", "apimart", "modelscope", "custom"]);
const MODEL_CAPABILITIES = new Set(["chat", "image", "video", "audio"]);

export function validateProviderDefinition(value: unknown): ValidationResult<ProviderDefinition> {
  const row = plainObject(value);
  const issues: ValidationIssue[] = [];
  requiredText(row.id, "id", issues);
  requiredText(row.name, "name", issues);
  const baseUrl = requiredText(row.baseUrl, "baseUrl", issues);
  if (baseUrl && !isHttpUrl(baseUrl)) issues.push(issue("baseUrl", "invalid", "baseUrl must be an HTTP(S) URL"));
  if (!PROVIDER_PROTOCOLS.has(row.protocol as ProviderProtocol)) issues.push(issue("protocol", "invalid", "protocol is not supported"));
  if (typeof row.enabled !== "boolean") issues.push(issue("enabled", "invalid", "enabled must be a boolean"));
  return issues.length === 0 ? { valid: true, value: value as ProviderDefinition, issues } : { valid: false, issues };
}

export function validateProviderModelDefinition(value: unknown, providerIds?: ReadonlySet<string>): ValidationResult<ProviderModelDefinition> {
  const row = plainObject(value);
  const issues: ValidationIssue[] = [];
  requiredText(row.id, "id", issues);
  const providerId = requiredText(row.providerId, "providerId", issues);
  requiredText(row.modelId, "modelId", issues);
  requiredText(row.displayName, "displayName", issues);
  if (!MODEL_CAPABILITIES.has(String(row.capability))) issues.push(issue("capability", "invalid", "capability is not supported"));
  if (typeof row.enabled !== "boolean") issues.push(issue("enabled", "invalid", "enabled must be a boolean"));
  if (providerId && providerIds && !providerIds.has(providerId)) issues.push(issue("providerId", "unknown_provider", `provider does not exist: ${providerId}`));
  return issues.length === 0 ? { valid: true, value: value as ProviderModelDefinition, issues } : { valid: false, issues };
}

export function createProviderRegistry(input: ProviderRegistryInput) {
  const issues: ValidationIssue[] = [];
  const providerMap = new Map<string, ProviderDefinition>();
  for (const [index, provider] of input.providers.entries()) {
    const result = validateProviderDefinition(provider);
    issues.push(...prefixIssues(result.issues, `providers.${index}`));
    if (!result.value) continue;
    if (providerMap.has(result.value.id)) issues.push(issue(`providers.${index}.id`, "duplicate", `duplicate provider id: ${result.value.id}`));
    else providerMap.set(result.value.id, freezeCopy(result.value));
  }

  const modelMap = new Map<string, ProviderModelDefinition>();
  for (const [index, model] of (input.models ?? []).entries()) {
    const result = validateProviderModelDefinition(model, new Set(providerMap.keys()));
    issues.push(...prefixIssues(result.issues, `models.${index}`));
    if (!result.value) continue;
    if (modelMap.has(result.value.id)) issues.push(issue(`models.${index}.id`, "duplicate", `duplicate model id: ${result.value.id}`));
    else modelMap.set(result.value.id, freezeCopy(result.value));
  }

  if (issues.length > 0) throw new ProviderRegistryValidationError(issues);

  return Object.freeze({
    getProvider: (id: string) => providerMap.get(id),
    getModel: (id: string) => modelMap.get(id),
    listProviders: (options?: { enabledOnly?: boolean }) => [...providerMap.values()].filter((item) => !options?.enabledOnly || item.enabled),
    listModels: (options?: { providerId?: string; enabledOnly?: boolean }) => [...modelMap.values()].filter((item) => (!options?.providerId || item.providerId === options.providerId) && (!options?.enabledOnly || item.enabled))
  });
}

export class ProviderRegistryValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`Provider registry validation failed with ${issues.length} issue(s)`);
    this.name = "ProviderRegistryValidationError";
    this.issues = issues;
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredText(value: unknown, path: string, issues: ValidationIssue[]) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) issues.push(issue(path, "required", `${path} is required`));
  return text;
}

function issue(path: string, code: ValidationIssue["code"], message: string): ValidationIssue {
  return { path, code, message };
}

function prefixIssues(issues: ValidationIssue[], prefix: string) {
  return issues.map((item) => ({ ...item, path: `${prefix}.${item.path}` }));
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function freezeCopy<T extends object>(value: T): T {
  return Object.freeze({ ...value });
}
