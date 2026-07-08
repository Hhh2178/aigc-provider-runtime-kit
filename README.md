# AIGC Provider Runtime Kit

Reusable TypeScript runtime primitives for AIGC products that need to manage multiple model providers and RunningHub entries without rebuilding the same provider configuration layer for every project.

![CI](https://github.com/Hhh2178/aigc-provider-runtime-kit/actions/workflows/ci.yml/badge.svg)

This project starts as a small, framework-neutral kit extracted from production lessons:

- Provider protocol and model capability types.
- Model parameter schema and UI metadata helpers.
- JSON and multipart request body helpers.
- RunningHub App / Workflow catalog types.
- RunningHub execution descriptor generation.
- RunningHub submit / poll client.
- RunningHub key-pool concurrency dispatch.
- Project harness docs and verification contracts for long-term maintenance.

## Status

`v0.1.0` is a foundation release. APIs are intentionally small and may evolve before a stable `1.0`.

## Package Entrypoints

| Entrypoint | Purpose |
| --- | --- |
| `aigc-provider-runtime-kit` | Combined runtime exports |
| `aigc-provider-runtime-kit/core` | Provider, model, schema, and request body helpers |
| `aigc-provider-runtime-kit/runninghub` | RunningHub catalog, descriptor, client, and key-pool helpers |
| `aigc-provider-runtime-kit/runtime` | Explicit combined runtime exports |

## Install

```bash
npm install aigc-provider-runtime-kit
```

Until the package is published to npm, consume the GitHub repository directly or copy the packages into an internal workspace.

## Quick Example

```ts
import { defaultParameterSchemaForModel } from "aigc-provider-runtime-kit/core";
import { buildRunningHubExecutionDescriptor } from "aigc-provider-runtime-kit/runninghub";

const schema = defaultParameterSchemaForModel("image", "gpt-image-2", "openai");

const execution = buildRunningHubExecutionDescriptor({
  kind: "app",
  appId: "rh-app-id",
  runTargetId: "rh-app-id",
  taskCapability: "image",
  fields: []
});
```

More examples:

- `docs/getting-started.md`
- `docs/api-reference.md`
- `examples/node-basic/`

## Repository Layout

```text
packages/core/        Provider, model, schema, and request body primitives
packages/runninghub/  RunningHub catalog, descriptor, client, and key-pool helpers
packages/runtime/     Combined public exports
docs/                 Harness, governance, system docs, specs, and plans
scripts/              Local verification contracts
examples/             Minimal usage examples
tests/                Node built-in test coverage for public behavior
.github/workflows/    GitHub CI verification
```

## Harness

This repository uses a lightweight doc-log harness:

- `AGENTS.md` is the AI agent constitution.
- `docs/INDEX.md` is the documentation router.
- `docs/systems/` owns system contracts.
- `docs/logbooks/` records audit evidence.
- `scripts/verify-harness.mjs` checks required project anchors.

Run:

```bash
npm run harness:verify:project
npm run type-check
npm test
```

## Local Development

```bash
npm ci
npm run harness:verify:project
npm run type-check
npm run build
npm test
```

## Public Project Docs

- `CONTRIBUTING.md` explains contribution flow and commit boundaries.
- `SECURITY.md` defines vulnerability and secret-handling rules.
- `CHANGELOG.md` records public release changes.
- `docs/roadmap.md` tracks the foundation roadmap without promising hosted infrastructure.

## Security

Never commit provider API keys, RunningHub keys, `.env` files, server credentials, or real customer configuration. This kit should contain reusable contracts and code only.
