# Changelog

All notable changes to `aigc-provider-runtime-kit` are recorded here.

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
