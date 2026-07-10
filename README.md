# AIGC Provider Runtime Kit

[![CI](https://github.com/Hhh2178/aigc-provider-runtime-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Hhh2178/aigc-provider-runtime-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

Framework-neutral TypeScript primitives for AIGC products that need to manage model providers, model parameters, request bodies, RunningHub Apps/Workflows, and provider key concurrency without rebuilding the same runtime layer in every project.

This repository is a small runtime kit, not a hosted service. It gives your application typed building blocks; your application keeps ownership of credentials, databases, queues, permissions, billing, and auditing.

## Why This Exists

Most AIGC applications eventually need the same provider infrastructure:

- A normalized way to describe providers and models.
- Model parameter schemas that can drive admin forms, canvas nodes, or API payloads.
- Request body helpers for JSON and multipart provider APIs.
- A reusable RunningHub App/Workflow catalog model.
- A safe way to submit, poll, and extract media outputs from RunningHub tasks.
- Key-pool helpers so multiple API keys can be used without exceeding concurrency limits.

`aigc-provider-runtime-kit` packages those common pieces as reusable TypeScript modules.

## Features

- **Provider contracts**: typed provider, model, capability, and parameter schema definitions.
- **Provider registry**: validate provider/model configuration, reject duplicate or dangling references, and query enabled entries.
- **OpenAI-compatible client**: call chat, image, or custom JSON endpoints without adding an SDK dependency.
- **Reusable retry policy**: opt-in exponential backoff with jitter, cancellation, and retry hooks.
- **UI-ready model metadata**: convert schemas into aspect ratio, size, duration, resolution, and reference-input metadata.
- **Request body helpers**: build multipart `FormData` payloads from scalar fields, remote URLs, or data URLs.
- **RunningHub catalog helpers**: normalize RunningHub App/Workflow records into reusable host-app entries.
- **Execution descriptors**: generate submit/poll/output handling metadata for RunningHub tasks.
- **RunningHub client**: submit tasks, poll results, normalize failures, and extract image/video/audio URLs.
- **Bounded execution**: task and request timeouts, cancellation signals, typed errors, and unknown-status protection.
- **Key-pool concurrency**: acquire and release RunningHub keys against a Redis-like runtime interface.
- **No framework lock-in**: works with Node.js services, workers, CLI tools, or any framework that can import ESM.
- **Governed project harness**: includes docs, CI, tests, and verification scripts to keep the package maintainable.

## Install

```bash
npm install aigc-provider-runtime-kit
```

The package is currently in the `0.2.x` runtime line. APIs may continue to evolve before `1.0`.

If the package has not been published to npm in your environment yet, install directly from GitHub:

```bash
npm install github:Hhh2178/aigc-provider-runtime-kit
```

## Requirements

- Node.js 22 or a modern runtime with ESM, `fetch`, `FormData`, `Blob`, and `AbortSignal.timeout`.
- TypeScript is recommended for the best developer experience.

## Package Entrypoints

| Entrypoint | Purpose |
| --- | --- |
| `aigc-provider-runtime-kit` | Combined runtime exports |
| `aigc-provider-runtime-kit/core` | Provider, model, schema, and request body helpers |
| `aigc-provider-runtime-kit/runninghub` | RunningHub catalog, descriptor, client, and key-pool helpers |
| `aigc-provider-runtime-kit/runtime` | Explicit combined runtime exports |

## Quick Start

Create UI-friendly model metadata from a provider model:

```ts
import {
  defaultParameterSchemaForModel,
  uiMetadataFromSchema
} from "aigc-provider-runtime-kit/core";

const schema = defaultParameterSchemaForModel("image", "gpt-image-2", "openai");
const ui = uiMetadataFromSchema(schema, "image");

console.log(ui.defaultAspectRatio);
console.log(ui.maxReferenceImages);
```

Validate and query provider configuration before using it:

```ts
import { createProviderRegistry } from "aigc-provider-runtime-kit/core";

const registry = createProviderRegistry({
  providers: [{
    id: "openai-compatible",
    name: "OpenAI-compatible API",
    baseUrl: "https://api.example.com/v1",
    protocol: "openai",
    enabled: true
  }],
  models: [{
    id: "image-primary",
    providerId: "openai-compatible",
    modelId: "image-model",
    displayName: "Primary image model",
    capability: "image",
    enabled: true
  }]
});

console.log(registry.listModels({ enabledOnly: true }));
```

Call an OpenAI-compatible endpoint with optional retry/backoff:

```ts
import { createOpenAICompatibleClient } from "aigc-provider-runtime-kit/core";

const client = createOpenAICompatibleClient({
  baseUrl: "https://api.example.com/v1",
  apiKey: process.env.PROVIDER_API_KEY,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000
  }
});

const response = await client.createImage({
  model: "image-model",
  prompt: "A cinematic tropical city"
});
```

Retries are opt-in. The client retries only retryable network failures, HTTP 408/409/429 responses, and 5xx responses when a retry policy is supplied.

Execute different providers through one runtime entrypoint:

```ts
import {
  createOpenAICompatibleAdapter,
  createOpenAICompatibleClient,
  createProviderRegistry,
  createProviderRuntime
} from "aigc-provider-runtime-kit/runtime";

const registry = createProviderRegistry({ providers, models });
const openaiClient = createOpenAICompatibleClient({
  baseUrl: "https://api.example.com/v1",
  apiKey: process.env.PROVIDER_API_KEY
});

const runtime = createProviderRuntime({
  registry,
  adapters: [createOpenAICompatibleAdapter({ client: openaiClient })],
  hooks: {
    onEvent(event) {
      console.log(event.type);
    }
  }
});

const result = await runtime.execute({
  providerId: "openai-compatible",
  modelId: "image-primary",
  input: { prompt: "A cinematic tropical city" }
});

console.log(result.outputs);
```

`providerId` and `modelId` refer to registry IDs. The runtime validates configuration and input, selects an adapter, propagates cancellation/timeouts, and returns normalized outputs.

Build a RunningHub execution descriptor:

```ts
import { buildRunningHubExecutionDescriptor } from "aigc-provider-runtime-kit/runninghub";

const execution = buildRunningHubExecutionDescriptor({
  kind: "workflow",
  workflowId: "workflow-id",
  runTargetId: "workflow-id",
  taskCapability: "video",
  fields: [
    {
      nodeId: "6",
      fieldName: "prompt",
      label: "Prompt",
      valueType: "string",
      required: true
    }
  ]
});

console.log(execution.submit.submitMode);
console.log(execution.polling.intervalMs);
```

Submit and poll a RunningHub task from your worker:

```ts
import { createRunningHubClient } from "aigc-provider-runtime-kit/runninghub";

const client = createRunningHubClient({
  apiKey: process.env.RUNNINGHUB_API_KEY!,
  baseUrl: "https://www.runninghub.cn"
});

const result = await client.runTask({
  targetType: "workflow",
  runTargetId: "workflow-id",
  workflowId: "workflow-id",
  nodeInfoList: [
    {
      nodeId: "6",
      fieldName: "prompt",
      fieldValue: "A cinematic robot walking through a rainy neon street"
    }
  ],
  timeoutMs: 10 * 60 * 1000
});

console.log(result.videoUrls);
```

Cancel a task from your host application and handle structured failures:

```ts
import {
  createRunningHubClient,
  isRunningHubError
} from "aigc-provider-runtime-kit/runninghub";

const controller = new AbortController();

try {
  await client.runTask({
    targetType: "workflow",
    runTargetId: "workflow-id",
    workflowId: "workflow-id",
    nodeInfoList: [],
    signal: controller.signal
  });
} catch (error) {
  if (isRunningHubError(error)) {
    console.error(error.code, error.stage, error.retryable);
  }
}
```

The client defaults to a 30-minute task timeout and a 2-minute timeout per HTTP request. Override them with `taskTimeoutMs` and `requestTimeoutMs` when creating the client, or use `timeoutMs` for one task.

Use key-pool helpers with a Redis-like runtime:

```ts
import {
  acquireRunningHubKey,
  releaseRunningHubKey
} from "aigc-provider-runtime-kit/runninghub";

const acquired = await acquireRunningHubKey({
  providerId: "runninghub",
  defaultConcurrency: 2,
  leaseSeconds: 60 * 60,
  runtime: redisLikeRuntime,
  keys: [
    {
      id: "key-1",
      note: "primary",
      apiKey: process.env.RUNNINGHUB_API_KEY,
      maxConcurrency: 2,
      enabled: true,
      isDefault: true
    }
  ]
});

if (!acquired.acquired) {
  throw new Error(`No RunningHub key available: ${acquired.reason}`);
}

try {
  // Run provider task with acquired.key.apiKey.
} finally {
  await releaseRunningHubKey({
    providerId: "runninghub",
    keyId: acquired.key.id,
    runtime: redisLikeRuntime
  });
}
```

Choose a lease long enough for the longest expected task. Each successful acquisition refreshes the lease, and the default is one hour.

## What You Can Build With It

- A multi-provider AIGC backend.
- A provider/model management admin panel.
- A visual canvas node runtime for image, video, audio, or workflow generation.
- A RunningHub App/Workflow gateway.
- A worker service that dispatches provider jobs with API key concurrency limits.
- A shared provider runtime layer reused across multiple products.

## What This Kit Does Not Do

- It does not store API keys or credentials.
- It does not provide a hosted API service.
- It does not include a database schema or migration system.
- It does not implement user permissions, billing, or quota policies.
- It does not ship an admin UI.
- It does not hide RunningHub or provider-specific business rules from your host application.

## Recommended Architecture

```text
Your app/admin UI
  -> your database and permission model
  -> your job queue or worker
  -> aigc-provider-runtime-kit
  -> provider APIs such as RunningHub or OpenAI-compatible services
```

Keep secrets and user permissions in your application. Use this package to normalize provider definitions, request contracts, task execution metadata, result extraction, and key-pool coordination.

## Documentation

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api-reference.md)
- [Roadmap](./docs/roadmap.md)
- [Provider System Notes](./docs/systems/providers/README.md)
- [RunningHub System Notes](./docs/systems/runninghub/README.md)
- [Project Harness Notes](./docs/systems/harness/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## Repository Layout

```text
packages/core/        Provider, model, schema, and request body primitives
packages/runninghub/  RunningHub catalog, descriptor, client, and key-pool helpers
packages/runtime/     Combined public exports
examples/             Minimal usage examples
tests/                Node built-in test coverage for public behavior
docs/                 Harness, governance, system docs, specs, and plans
scripts/              Local verification contracts
.github/workflows/    GitHub CI verification
```

## Local Development

```bash
npm ci
npm run harness:verify:project
npm run type-check
npm run build
npm test
npm run test:package
```

Use the full release gate before publishing or tagging:

```bash
npm run harness:verify:release
```

## Harness

This repository uses a lightweight doc-log Harness so future maintainers and AI agents can understand and verify changes without guessing:

- `AGENTS.md` is the agent constitution.
- `docs/INDEX.md` is the documentation router.
- `docs/systems/` owns system contracts.
- `docs/logbooks/` records audit evidence.
- `scripts/verify-harness.mjs` checks required project anchors.

## Security

Never commit provider API keys, RunningHub keys, `.env` files, private keys, server credentials, customer data, or real production configuration.

Host applications are responsible for:

- Secret storage.
- Permission checks.
- Provider quotas.
- Audit logs.
- Network egress controls.
- Incident response.

See [SECURITY.md](./SECURITY.md) for details.

## Contributing

Contributions are welcome. Please keep changes small, typed, tested, and framework-neutral. If you change public exports or runtime behavior, update the API reference and relevant system docs.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

## License

MIT. See [LICENSE](./LICENSE).
