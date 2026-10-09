import { parseInputCapabilities, type ProviderModelDefinition, type ValidationIssue, type ValidationResult } from "../core/index.js";

export function validateProviderExecutionInput(model: ProviderModelDefinition, input: unknown): ValidationResult<Record<string, unknown>> & { warnings?: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, issues: [{ path: "input", code: "invalid", message: "input must be an object" }] };
  }
  const value = input as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const warnings: string[] = [];
  const knownFields = new Set<string>();
  for (const [field, rawRule] of Object.entries(model.parameterSchema ?? {})) {
    knownFields.add(field);
    const rule = plainObject(rawRule);
    const fieldValue = value[field];
    const path = `input.${field}`;
    if (rule.required === true && isMissing(fieldValue)) {
      issues.push({ path, code: "required", message: `${field} is required` });
      continue;
    }
    if (isMissing(fieldValue)) continue;
    validateType(path, fieldValue, rule, issues);
    validateOptions(path, fieldValue, rule, issues);
    validateRange(path, fieldValue, rule, issues);
    validateMaximum(path, fieldValue, rule, issues);
  }
  validateCapabilities(model, value, issues);
  for (const field of Object.keys(value)) {
    if (!knownFields.has(field)) warnings.push(`unknown input field "${field}" is passed through to the adapter unchanged`);
  }
  if (issues.length > 0) return { valid: false, issues };
  return warnings.length > 0 ? { valid: true, value, issues, warnings } : { valid: true, value, issues };
}

function validateType(path: string, value: unknown, rule: Record<string, unknown>, issues: ValidationIssue[]) {
  const type = String(rule.type || "").toLowerCase();
  let valid = true;
  if (["string", "text"].includes(type)) valid = typeof value === "string";
  else if (["select", "enum"].includes(type)) valid = typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
  else if (["number", "range"].includes(type)) valid = typeof value === "number" && Number.isFinite(value);
  else if (type === "integer") valid = typeof value === "number" && Number.isInteger(value);
  else if (type === "boolean") valid = typeof value === "boolean";
  else if (type.endsWith("[]")) valid = Array.isArray(value);
  if (!valid) issues.push({ path, code: "invalid", message: `${path} must match type ${type}` });
}

function validateCapabilities(model: ProviderModelDefinition, input: Record<string, unknown>, issues: ValidationIssue[]) {
  const capabilities = parseInputCapabilities({ ...model.inputCapabilities, parameterSchema: model.parameterSchema }, model.capability);
  const mappings: Array<[string, boolean | undefined]> = [
    ["referenceImages", capabilities.imageReference],
    ["firstFrame", capabilities.firstFrame],
    ["lastFrame", capabilities.lastFrame],
    ["mask", capabilities.mask],
    ["referenceAudio", capabilities.audioReference],
    ["videoReference", capabilities.videoReference]
  ];
  for (const [field, supported] of mappings) {
    if (!isMissing(input[field]) && !supported) issues.push({ path: `input.${field}`, code: "unsupported", message: `${field} is not supported by model ${model.id}` });
  }
}

function validateOptions(path: string, value: unknown, rule: Record<string, unknown>, issues: ValidationIssue[]) {
  if (!Array.isArray(rule.options) || Array.isArray(value)) return;
  // Compare stringified values so numeric inputs (1024) match string options ("1024").
  if (!rule.options.some((option) => String(option) === String(value))) {
    issues.push({ path, code: "invalid", message: `${path} is not an allowed option` });
  }
}

function validateRange(path: string, value: unknown, rule: Record<string, unknown>, issues: ValidationIssue[]) {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const min = Number(rule.min);
  const max = Number(rule.max);
  if (Number.isFinite(min) && value < min) issues.push({ path, code: "out_of_range", message: `${path} must be at least ${min}` });
  if (Number.isFinite(max) && value > max) issues.push({ path, code: "out_of_range", message: `${path} must be at most ${max}` });
}

function validateMaximum(path: string, value: unknown, rule: Record<string, unknown>, issues: ValidationIssue[]) {
  const max = Number(rule.max);
  if (Array.isArray(value) && Number.isFinite(max) && value.length > max) {
    issues.push({ path, code: "out_of_range", message: `${path} accepts at most ${max} item(s)` });
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isMissing(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}
