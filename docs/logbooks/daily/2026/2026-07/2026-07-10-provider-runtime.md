# 2026-07-10 Provider Runtime

## Intent

Complete the next standalone SDK stage with validated provider configuration, a reusable OpenAI-compatible client, opt-in retry/backoff, and installed-package verification.

## Changed

| Area | Files | Purpose |
| --- | --- | --- |
| Provider registry | `packages/core/src/provider-registry.ts` | Validate providers/models and expose immutable lookups |
| Retry policy | `packages/core/src/retry.ts` | Add bounded exponential backoff, jitter, cancellation, and hooks |
| Provider client | `packages/core/src/openai-compatible.ts` | Add chat, image, and custom OpenAI-compatible JSON requests |
| Package verification | `scripts/verify-package.mjs` | Pack, install, and import the actual tarball in an isolated consumer |
| Tests | `tests/provider-runtime.test.mjs` | Cover registry integrity, retries, HTTP behavior, and non-retryable errors |
| Documentation | `README.md`, `docs/*`, `CHANGELOG.md` | Document new public contracts and safety decisions |

## Verification

| Check | Result |
| --- | --- |
| `npm run harness:verify:release` | Passed |
| `npm test` | Passed (20 tests) |
| Installed tarball consumer | Passed |
| `npm audit --audit-level=high` | Passed (0 vulnerabilities) |

## Decisions

- Keep retries opt-in to reduce accidental duplicate generations or charges.
- Keep the OpenAI-compatible client dependency-free and expose a generic request method for nonstandard endpoints.
- Fail registry creation early when configuration contains duplicate IDs or dangling provider references.

## Risks

- Vendor-specific video endpoints still require custom paths and response interpretation by the host application.
- Registry validation is structural and does not contact providers to verify credentials or model availability.

## Next

Add provider-specific retry presets, configuration loaders, and deeper parameter-schema validation as needed.
