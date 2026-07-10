# RunningHub System

## Purpose

The RunningHub system provides reusable contracts and helpers for RunningHub AI App / Workflow integration.

## Ownership

- Code: `packages/runninghub/src/`
- Public exports: `packages/runninghub/src/index.ts`
- API reference: `docs/api-reference.md`
- Tests: `tests/runninghub.test.mjs`

## Runtime Shape

1. Host app creates or imports a RunningHub catalog entry.
2. Kit normalizes fields into input slots.
3. Kit builds an execution descriptor.
4. Host worker uses `createRunningHubClient` to submit and poll.
5. Optional key-pool helpers manage multi-key concurrency.

The client applies bounded request and task timeouts, accepts an `AbortSignal`, and reports typed `RunningHubError` failures. The key pool uses a configurable concurrency lease so stale counters can recover.

## Interfaces

| Interface | Direction | Contract |
| --- | --- | --- |
| Catalog source | Host app -> kit | `RhCatalogSource` |
| Execution descriptor | Kit -> host app | `RhExecutionDescriptor` |
| RH client | Host worker -> RH API | `createRunningHubClient` |
| Key pool | Host worker -> runtime store | `acquireRunningHubKey`, `releaseRunningHubKey` |

## Failure Modes

- App/workflow IDs are mixed.
- Fields do not match upstream RunningHub node info.
- Poll returns success with no usable output URL.
- Poll returns an unknown status or exceeds its timeout.
- The host aborts an in-flight task.
- All keys are busy or no enabled keys exist.

## Verification

```bash
npm run type-check
npm test
```
