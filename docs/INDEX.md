# Documentation Index

This file is the first-hop router for `aigc-provider-runtime-kit`.

## Fast Path For New Agents

1. Read `AGENTS.md`.
2. Read `README.md`.
3. Read this index.
4. Read the relevant system document:
   - `docs/systems/providers/README.md`
   - `docs/systems/runninghub/README.md`
   - `docs/systems/harness/README.md`
5. Check the latest daily log under `docs/logbooks/daily/`.

## Source Of Truth

| Topic | Canonical Source |
| --- | --- |
| Agent rules | `AGENTS.md` |
| Project overview | `README.md` |
| Provider runtime architecture | `docs/systems/providers/README.md` |
| RunningHub architecture | `docs/systems/runninghub/README.md` |
| Harness verification | `docs/systems/harness/README.md` |
| Interface doc template | `docs/systems/interface-documentation-template.md` |
| Governance rules | `docs/governance/` |
| Daily work evidence | `docs/logbooks/daily/` |
| Specs and plans | `docs/superpowers/specs/`, `docs/superpowers/plans/` |

## Verification

```bash
npm run harness:verify:project
npm run type-check
```

## Update Rules

- Add new system docs under `docs/systems/`.
- Add durable rules under `docs/governance/`.
- Add task records under `docs/logbooks/`.
- Add feature design and execution docs under `docs/superpowers/`.
