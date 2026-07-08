# API Reference

## Package Entrypoints

| Entrypoint | Purpose |
| --- | --- |
| `aigc-provider-runtime-kit` | Combined runtime exports |
| `aigc-provider-runtime-kit/core` | Provider, model, schema, and request body helpers |
| `aigc-provider-runtime-kit/runninghub` | RunningHub catalog, descriptor, client, and key-pool helpers |
| `aigc-provider-runtime-kit/runtime` | Explicit combined runtime exports |

## Core Helpers

### `defaultParameterSchemaForModel(capability, modelId, protocol?)`

Returns a practical default parameter schema for image, video, audio, or chat models.

### `parseModelParameterSchema(value)`

Accepts an object or JSON string and returns a safe model parameter schema. Invalid input returns an empty object.

### `mergeModelParameterSchema(capability, modelId, protocol, value)`

Combines default model parameters with user or admin supplied overrides.

### `uiMetadataFromSchema(schemaValue, capability, inputCapabilitiesValue?)`

Converts a parameter schema into UI-friendly metadata such as aspect ratios, default size, duration options, reference support, and input capability flags.

### `durationOptionsFromRange(range?)`

Expands a duration range into sorted duration options.

### `isMultipartRequestBodyMode(value)`

Checks whether a provider request mode should be treated as multipart form data.

### `buildProviderMultipartRequestBody(payload, fileFieldNamesValue)`

Builds a `FormData` request body from scalar fields and file URL or data URL fields.

## RunningHub Helpers

### `normalizeRunningHubInputSlots(fields)`

Converts RunningHub field definitions into reusable host-app input slot definitions.

### `buildRunningHubExecutionDescriptor(item)`

Builds a host-app execution descriptor for RunningHub App or Workflow entries.

### `normalizeRunningHubCatalogItem(source)`

Normalizes a source catalog record into a complete RunningHub catalog item.

### `createRunningHubClient(options)`

Creates a minimal RunningHub submit/poll client. Host applications should wrap this client with their own permission, quota, credential, and audit layers.

### `extractRunningHubOutputUrls(value)`

Extracts image, video, and audio URLs from nested RunningHub result payloads.

### `acquireRunningHubKey(input)` and `releaseRunningHubKey(input)`

Provide key-pool concurrency helpers against a Redis-like runtime interface.

### `orderRunningHubKeys(keys, preferredKeyId?)`

Orders enabled keys by preferred key, default key, then other enabled keys.

## Stability

This is a `0.1.x` foundation API. Prefer wrapping package calls behind a host-app adapter if you need long-term compatibility before `1.0`.
