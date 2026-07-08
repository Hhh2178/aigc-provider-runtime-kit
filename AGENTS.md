# AGENTS.md - Project Agent Constitution

## Project Identity

- Project name: `aigc-provider-runtime-kit`
- Active root: `D:\codex\多API服务商管理后台`
- GitHub target: `Hhh2178/aigc-provider-runtime-kit`
- Purpose: reusable Provider and RunningHub runtime kit for AIGC applications.

## First Reading Order

Before meaningful work, read:

1. `AGENTS.md`
2. `README.md`
3. `docs/INDEX.md`
4. Latest daily log under `docs/logbooks/daily/`
5. Relevant system docs under `docs/systems/`

## Authority Model

| Fact | Canonical Source | Update Trigger |
| --- | --- | --- |
| Project rules | `AGENTS.md` | Safety, workflow, or repo boundary changes |
| Human overview | `README.md` | Public positioning, setup, or command changes |
| Docs routing | `docs/INDEX.md` | Documents added, moved, or archived |
| Provider architecture | `docs/systems/providers/README.md` | Provider API or schema changes |
| RunningHub architecture | `docs/systems/runninghub/README.md` | RH catalog/client/dispatch changes |
| Harness checks | `docs/systems/harness/README.md` and `scripts/verify-harness.mjs` | Verification commands or required anchors change |
| Work evidence | `docs/logbooks/` | Any meaningful implementation or governance change |

## Safety Rules

- Do not commit secrets, `.env`, API keys, private keys, real provider credentials, customer configs, or server output.
- Do not copy application-specific database schemas, user tables, deployment logs, or private business records from source projects.
- Do not use destructive Git operations such as hard reset, forced checkout, or force push unless the user explicitly requests them.
- Keep this project framework-neutral unless a system document explicitly approves a framework-specific adapter.

## Editing Rules

- Prefer small, reusable modules over application-specific glue.
- Public exports must be documented in `README.md` or relevant system docs.
- New systems require docs under `docs/systems/`.
- New governance rules require updates to `docs/governance/`.
- New verification assumptions require updates to `scripts/verify-harness.mjs`.

## Verification Duties

Before claiming completion, run the relevant checks:

```bash
npm run harness:verify:project
npm run type-check
```

If dependencies are unavailable, state exactly which check could not run and why.

## Logging Duties

Record meaningful work in `docs/logbooks/daily/YYYY/YYYY-MM/YYYY-MM-DD.md` with:

- intent
- files changed
- verification
- decisions
- risks
- next step

## Stop And Ask

Pause before:

- Publishing or deleting a GitHub repository.
- Changing package names or public API shape after release.
- Adding real provider credentials.
- Adding a database or hosted service dependency.
- Pulling code from private projects that may contain secrets or customer-specific logic.
