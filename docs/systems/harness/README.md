# Harness System

## Purpose

The harness keeps this repository understandable, auditable, and safe for AI-assisted development.

## Runtime Shape

- Lightweight doc-log mode.
- No ledger database in v0.1.
- `scripts/verify-harness.mjs` validates required anchors.

## Verification

```bash
npm run harness:verify:project
npm run type-check
```

## Failure Modes

- Missing docs after adding systems.
- Public API changed without README/system doc update.
- Secret patterns missing from `.gitignore`.
