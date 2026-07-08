# AIGC Provider Runtime Kit Design

## Problem

AIGC products repeatedly rebuild the same provider configuration, model schema, request-body, RunningHub catalog, key-pool, and worker execution logic.

## Goals

- Provide framework-neutral TypeScript primitives.
- Keep secrets and persistence in host applications.
- Support OpenAI-compatible providers and RunningHub as first-class runtime shapes.
- Preserve a strong harness from the first commit.

## Non-goals

- No hosted backend in v0.1.
- No production admin UI in v0.1.
- No real provider credentials or customer configs.

## Acceptance Criteria

- Core provider types compile.
- RunningHub descriptor/client/key-pool helpers compile.
- Harness verification passes.
- README explains install, usage, layout, harness, and security.
