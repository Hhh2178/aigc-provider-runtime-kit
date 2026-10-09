# Changelog

All notable changes to `aigc-provider-runtime-kit` are recorded here.

## 0.3.1 - 2026-10-09

### Added

- Task framework phase-2 slice A in the control center: `cc_tasks`/`cc_task_events` migrations,
  PG SKIP LOCKED atomic claim queue, idempotency keys, heartbeat patching, stale-running reaper,
  task event stream.
- Task HTTP API (`POST /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel`, admin
  list) with machine-token auth (`CC_TASK_API_TOKEN`) that degrades to admin sessions when unset.
- Task worker (`npm run start:worker -w @aigc-kit/control-center`) with claim slots, task timeout
  AbortSignal, stale reaper, and protocol dispatch: openai-family chat/image/video(poll)/audio and
  RunningHub catalog submit/poll via the kit client. Remaining production protocols
  (apimart/aicopy/grsai/volcengine/gemini) fail explicitly with `adapter_not_ported` until the
  next slice.
- `start:worker` npm script and config knobs (`CC_TASK_API_TOKEN`, `CC_WORKER_CONCURRENCY`).

## 0.3.0 - 2026-10-09

### Changed

- Repository is now an npm-workspaces monorepo: the published SDK lives in `packages/kit`
  (`aigc-provider-runtime-kit` 0.3.0) and the new control-center backend lives in
  `packages/control-center` (`@aigc-kit/control-center` 0.1.0, private). Public SDK entrypoints
  and exports are unchanged.
- Provider protocols now include `aicopy` and `grsai_draw`; capability tags got
  `audio_cover` and `audio_extend`, aligning the type surface with the production canvas.

### Fixed

- Upstream response bodies are now read with a hard byte cap (64 MiB default for
  OpenAI-compatible/multipart, 16 MiB for RunningHub), so oversized or hostile payloads can no
  longer exhaust the heap.
- The provider registry deep-freezes nested definitions (advancedConfig etc.) without mutating
  the caller's objects.
- Input validation compares select options stringified, so numeric inputs match string options.
- Unknown input fields are no longer silently ignored: they pass through and surface as
  `result.warnings`.
- Runtime hook failures are reported through the new `hooks.onHookError` instead of vanishing.
- RunningHub polling accepts an exponential-backoff strategy (default remains fixed interval);
  output URLs without a known media extension can be discarded or returned in
  `unclassifiedUrls` via `unclassifiedOutputs` (default keeps legacy behavior).

### Added

- Control-center phase 1 (management surface) on PostgreSQL: providers CRUD/probe/fetch-models/
  import, models CRUD and capability tests (generation tests require `confirmCost`), RunningHub
  catalog items/groups/key-pool management with draft analyze, AES-256-GCM `enc:v1:` secret
  storage previewed as `...last4`, admin sessions with audit logging, embedded PG migrations with
  a neutral `cc_*` schema reserving `tenant_id` for multi-tenancy.
- `docs/systems/control-center/README.md` with architecture map and invariants.
- Harness and package verification updated for the workspace layout.

## 0.2.0 - 2026-07-10

### Fixed

- Correct video-model reference image capability inference.
- Reject unknown RunningHub task states instead of treating them as successful completion.

### Added

- Typed `RunningHubError` failures, bounded request/task timeouts, and task cancellation.
- Configurable RunningHub key-pool leases.
- Package export verification and release-safe npm package contents.
- Tests for multipart data URLs, RunningHub execution failures/cancellation, and key-pool leases.
- Provider/model registry validation with duplicate and referential-integrity checks.
- Dependency-free OpenAI-compatible chat, image, and custom JSON client.
- Opt-in exponential retry/backoff helper with jitter and cancellation.
- Installed-tarball consumer smoke testing for published entrypoints.
- Unified `ProviderAdapter` contract and `createProviderRuntime` execution entrypoint.
- Standard text/image/video/audio/JSON outputs and normalized usage metadata.
- Model input validation for required fields, types, options, ranges, list limits, and capabilities.
- OpenAI-compatible and RunningHub runtime adapters.
- Lifecycle and progress events through isolated observability hooks.

## 0.1.0 - 2026-07-08

### Added

- Initial framework-neutral TypeScript runtime kit.
- Provider model schema and UI metadata helpers.
- JSON and multipart request body helpers.
- RunningHub catalog, execution descriptor, submit/poll client, and key-pool helpers.
- Lightweight project harness with docs routing, governance records, and verification script.
- GitHub CI, public contribution/security docs, API reference, roadmap, and unit tests.
