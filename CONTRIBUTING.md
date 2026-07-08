# Contributing

Thanks for helping improve `aigc-provider-runtime-kit`. This project is intentionally small, framework-neutral, and reusable across AIGC applications.

## Before You Start

Read these files first:

1. `AGENTS.md`
2. `README.md`
3. `docs/INDEX.md`
4. Relevant system docs under `docs/systems/`

## Local Workflow

```bash
npm ci
npm run harness:verify:project
npm run type-check
npm test
```

Use small pull requests with one clear purpose. If you add or change public exports, update `README.md`, `docs/api-reference.md`, and the relevant system document.

## Design Principles

- Keep provider code framework-neutral.
- Prefer typed contracts over application-specific glue.
- Do not copy private project schemas, customer data, deployment logs, or credentials.
- Add tests for runtime behavior before claiming a change is complete.
- Record meaningful work in the daily logbook when working in this repository directly.

## Commit Boundaries

Good commit boundaries:

- Runtime code plus tests for one behavior.
- Documentation and harness updates.
- CI or packaging updates.

Avoid mixing runtime behavior changes with unrelated documentation rewrites.
