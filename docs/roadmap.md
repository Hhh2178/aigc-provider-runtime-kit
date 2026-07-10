# Roadmap

## Current Line: 0.1.x Foundation

Goal: provide stable, framework-neutral primitives that other AIGC products can reuse without copying provider-specific glue.

Completed:

- Provider/model schema contracts.
- UI metadata helpers.
- Multipart request body helper.
- RunningHub catalog and execution descriptor helpers.
- RunningHub submit/poll client.
- Bounded RunningHub task/request timeouts, cancellation, and typed errors.
- RunningHub key-pool concurrency helper.
- Package export verification and release-safe package contents.
- Typed provider registry validation and lookup.
- OpenAI-compatible chat/image/custom JSON client.
- Opt-in retry/backoff policy helper.
- Installed-package consumer smoke testing.
- Harness, CI, docs, and unit tests.

## 0.2.x Candidate Work

- Add provider adapter examples for vendor-specific video APIs.
- Add fixtures for common RunningHub App and Workflow shapes.
- Add idempotency-key guidance and provider-specific retry presets.
- Add optional host-app adapter examples for Express/Fastify without making them core dependencies.
- Add package export compatibility tests.

## 0.3.x Candidate Work

- Add environment/file loaders around the typed provider registry.
- Add deeper validation for admin-edited model parameter schemas.
- Add observability hooks for audit events, timing, provider status, and retry decisions.
- Add more complete key-pool strategies such as weighted dispatch and cooldown windows.

## Deferred Until Explicitly Needed

- Hosted admin backend.
- Database migrations.
- Browser UI.
- Worker queue implementation.
- Secrets manager integration.
- Product-specific permission models.

## Compatibility Policy Before 1.0

Breaking changes are allowed when they improve the public contract, but they must be documented in `CHANGELOG.md` and covered by tests.
