# 2026-07-10 Unified Runtime

## Intent

Deliver the 0.2.0 unified execution layer so applications can run different providers through one validated, observable contract.

## Changed

| Area | Files | Purpose |
| --- | --- | --- |
| Runtime contracts | `packages/runtime/src/contracts.ts` | Define adapter, request, result, output, usage, progress, and event contracts |
| Unified execution | `packages/runtime/src/runtime.ts` | Resolve configuration, validate, select adapters, execute, and normalize results |
| Input validation | `packages/runtime/src/input-validation.ts` | Validate required fields, types, options, ranges, lists, and capabilities |
| Built-in adapters | `packages/runtime/src/adapters.ts` | Bridge OpenAI-compatible and RunningHub clients into the unified runtime |
| Tests | `tests/runtime.test.mjs` | Cover execution, validation, adapter selection, timeouts, hooks, mapping, and normalization |
| Release | `package.json`, `package-lock.json`, `CHANGELOG.md` | Prepare version 0.2.0 |
| Documentation | `README.md`, `docs/*` | Document architecture, public API, examples, and boundaries |

## Verification

| Check | Result |
| --- | --- |
| `npm run harness:verify:release` | Passed |
| `npm test` | Passed (26 tests) |
| Installed tarball consumer | Passed |
| `npm audit --audit-level=high` | Passed (0 vulnerabilities) |

## Decisions

- Registry model IDs are the public execution identifiers; upstream model IDs remain adapter concerns.
- Adapter clients are injected so credentials remain owned by the host application.
- Observability hooks are isolated from execution success/failure.
- Raw provider responses remain optional while standard outputs are always available.

## Risks

- Vendor-specific async video providers still need dedicated adapters or endpoint/result normalization callbacks.
- Version 0.2.0 remains pre-1.0 and may evolve as real host applications integrate it.

## Next

Integrate 0.2.0 into a host application, collect provider fixtures, and add provider-specific adapters based on real demand.
