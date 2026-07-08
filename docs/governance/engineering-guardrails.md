# Engineering Guardrails

## Safety

- Never commit `.env`, API keys, private keys, customer configs, real provider credentials, or server output.
- Keep public packages framework-neutral unless explicitly scoped as an adapter.
- Do not copy app-specific database tables or private business logic from source projects.
- Do not force-push or rewrite history unless explicitly requested.

## Code Boundaries

- `packages/core` must remain provider-agnostic.
- `packages/runninghub` may contain RunningHub-specific protocol behavior.
- `packages/runtime` re-exports public APIs and should not contain heavy logic.
- Examples must use fake IDs and fake credentials only.

## Verification

Run before claiming completion:

```bash
npm run harness:verify:project
npm run type-check
```
