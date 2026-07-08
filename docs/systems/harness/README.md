# Harness System

## Purpose

The harness keeps this repository understandable, auditable, and safe for AI-assisted development.

## Runtime Shape

- Lightweight doc-log mode.
- No ledger database in v0.1.
- `scripts/verify-harness.mjs` validates required anchors.
- `.github/workflows/ci.yml` runs install, harness verification, type-check, build, and tests.
- Node built-in tests under `tests/` protect public package behavior.

## Verification

```bash
npm run harness:verify:project
npm run type-check
npm test
```

## Failure Modes

- Missing docs after adding systems.
- Public API changed without README/system doc update.
- Secret patterns missing from `.gitignore`.
- CI, package exports, or tests drift from the public README claims.
