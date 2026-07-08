# Documentation Governance Standard

## Rules

- One fact has one canonical source.
- Root files summarize and link; they do not store long histories.
- System docs explain how runtime systems work.
- Logbooks prove what changed and why.
- Specs describe intent and constraints.
- Plans describe executable phases and verification.

## Lifecycle

| State | Meaning |
| --- | --- |
| Draft | Proposed but not yet implemented |
| Active | Current canonical guidance |
| Superseded | Replaced by a newer document |
| Archived | Kept for history only |

## Required Maintenance

- Update `docs/INDEX.md` when adding or moving docs.
- Update system docs when public APIs, types, runtime behavior, or failure modes change.
- Update daily logs after meaningful changes.
