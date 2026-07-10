# 2026-07-10 Runtime Hardening

## Intent

Harden the standalone SDK so clean checkouts can build, test, package, and safely execute bounded RunningHub tasks.

## Changed

| Area | Files | Purpose |
| --- | --- | --- |
| Model metadata | `packages/core/src/model-schema.ts` | Correct video reference-image capability inference |
| RunningHub runtime | `packages/runninghub/src/*` | Add typed errors, timeouts, cancellation, status validation, and configurable key leases |
| Package release | `package.json`, `scripts/verify-package.mjs`, `.github/workflows/ci.yml` | Build before packing, constrain Node, limit package contents, and verify exports |
| Tests | `tests/*.test.mjs` | Cover multipart, client, cancellation, status handling, and key-pool behavior |
| Documentation | `README.md`, `docs/*`, `CHANGELOG.md` | Document public behavior and release guarantees |

## Verification

| Check | Result |
| --- | --- |
| `npm run harness:verify:project` | Passed |
| `npm run type-check` | Passed |
| `npm test` | Passed (15 tests) |
| `npm run test:package` | Passed |
| `npm pack --dry-run` | Passed; examples excluded |

## Decisions

- Keep the project a framework-neutral SDK rather than adding a hosted API, database, queue, or admin UI.
- Preserve existing public functions while adding optional safeguards and typed error exports.
- Use Node.js 22 as the explicit supported runtime baseline.

## Risks

- Upstream RunningHub response shapes may evolve and require additional fixtures.
- Retry/backoff remains a host policy and is not automated in this change.

## Next

Add provider registry validation and additional provider adapters in later releases.
