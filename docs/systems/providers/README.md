# Providers System

## Purpose

The Providers system defines framework-neutral contracts for AIGC provider configuration:

- provider protocol
- model capability
- model parameter schema
- UI metadata
- JSON/multipart request body construction

## Ownership

- Code: `packages/core/src/`
- Public docs: `README.md`
- API reference: `docs/api-reference.md`
- Tests: `tests/core.test.mjs`

## Interfaces

| Interface | Direction | Contract |
| --- | --- | --- |
| Provider definitions | Host app -> kit | `ProviderDefinition` |
| Model definitions | Host app -> kit | `ProviderModelDefinition` |
| Parameter schema | Host app -> UI/runtime | `ModelParameterSchema` |
| Multipart builder | Runtime -> provider API | `buildProviderMultipartRequestBody` |

## Design Rules

- Differences should be dataized as schema/config before adding provider-specific code.
- Provider API keys stay in host applications, not this kit.
- The core package must not import host app code.

## Verification

```bash
npm run type-check
npm test
```
