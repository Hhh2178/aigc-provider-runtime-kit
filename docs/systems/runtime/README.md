# Unified Provider Runtime

## Purpose

The unified runtime lets host applications execute configured models without branching on provider-specific clients.

## Ownership

- Code: `packages/runtime/src/`
- Public exports: `aigc-provider-runtime-kit` and `aigc-provider-runtime-kit/runtime`
- API reference: `docs/api-reference.md`
- Tests: `tests/runtime.test.mjs`

## Execution Flow

1. Resolve the requested provider and model from the validated registry.
2. Reject missing, disabled, or mismatched configuration.
3. Validate input against the model parameter schema and input capabilities.
4. Select the first adapter whose `supports` method accepts the provider/model pair.
5. Execute with propagated timeout, cancellation, metadata, and progress events.
6. Return standard outputs and usage while preserving optional raw provider data.

## Boundaries

- Adapters receive already configured clients; the runtime does not store credentials.
- Hooks are observational and cannot break provider execution.
- The runtime does not persist tasks, enqueue jobs, or implement permissions/billing.
- Retries remain an explicit client/adapter policy because generation calls may not be idempotent.

## Verification

```bash
npm run harness:verify:release
```
