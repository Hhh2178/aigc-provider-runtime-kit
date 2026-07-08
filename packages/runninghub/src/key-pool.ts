import type { RunningHubKeyPoolItem } from "./types.js";

export interface RunningHubKeyPoolRuntime {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RunningHubKeyAcquireInput {
  providerId: string;
  preferredKeyId?: string;
  keys: RunningHubKeyPoolItem[];
  defaultConcurrency: number;
  runtime: RunningHubKeyPoolRuntime;
  windowKey?: (providerId: string, keyId: string) => string;
}

export interface RunningHubKeyAcquireResult {
  acquired: boolean;
  key?: RunningHubKeyPoolItem;
  reason?: "no_enabled_keys" | "all_keys_busy";
}

export async function acquireRunningHubKey(input: RunningHubKeyAcquireInput): Promise<RunningHubKeyAcquireResult> {
  const ordered = orderRunningHubKeys(input.keys, input.preferredKeyId);
  if (ordered.length === 0) return { acquired: false, reason: "no_enabled_keys" };
  for (const item of ordered) {
    const limit = Math.max(1, Number(item.maxConcurrency || input.defaultConcurrency) || 1);
    const key = (input.windowKey || defaultWindowKey)(input.providerId, item.id);
    const current = Number(await input.runtime.get(key).catch(() => "0")) || 0;
    if (current >= limit) continue;
    const next = await input.runtime.incr(key);
    if (next === 1) await input.runtime.expire(key, 60 * 60);
    if (next > limit) {
      await input.runtime.decr(key).catch(() => undefined);
      continue;
    }
    return { acquired: true, key: item };
  }
  return { acquired: false, reason: "all_keys_busy" };
}

export async function releaseRunningHubKey(input: Pick<RunningHubKeyAcquireInput, "providerId" | "runtime" | "windowKey"> & { keyId: string }) {
  const key = (input.windowKey || defaultWindowKey)(input.providerId, input.keyId);
  const current = Number(await input.runtime.get(key).catch(() => "0")) || 0;
  if (current <= 0) return;
  const next = await input.runtime.decr(key).catch(() => current - 1);
  if (Number(next) <= 0) await input.runtime.del(key).catch(() => undefined);
}

export function orderRunningHubKeys(keys: RunningHubKeyPoolItem[], preferredKeyId?: string) {
  const enabled = keys.filter((item) => item.enabled && item.apiKey);
  return [
    ...enabled.filter((item) => item.id === preferredKeyId),
    ...enabled.filter((item) => item.id !== preferredKeyId && item.isDefault),
    ...enabled.filter((item) => item.id !== preferredKeyId && !item.isDefault)
  ];
}

function defaultWindowKey(providerId: string, keyId: string) {
  return `aigc-provider-runtime-kit:runninghub:${providerId}:${keyId}`;
}
