# RunningHub System

## Purpose

The RunningHub system provides reusable contracts and helpers for RunningHub AI App / Workflow integration.

## Ownership

- Code: `packages/runninghub/src/`
- Public exports: `packages/runninghub/src/index.ts`

## Runtime Shape

1. Host app creates or imports a RunningHub catalog entry.
2. Kit normalizes fields into input slots.
3. Kit builds an execution descriptor.
4. Host worker uses `createRunningHubClient` to submit and poll.
5. Optional key-pool helpers manage multi-key concurrency.

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
- All keys are busy or no enabled keys exist.

## Verification

```bash
npm run type-check
```
