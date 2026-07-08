# Root Entry Responsibility Matrix

| Entry | Owns | Must Not Own | Update Trigger |
| --- | --- | --- | --- |
| `AGENTS.md` | Agent constitution, safety rules, reading order, verification duties | Long release history, implementation details | Rule or workflow boundary changes |
| `README.md` | Public overview, install/use examples, package layout | Private notes, secrets, daily logs | Public positioning or command changes |
| `MEMORY.md` | Stable cross-session pointers | Full task history | Root, repo, or command changes |
| `DEVLOG.md` | Compatibility pointer to logbooks | Detailed diary | Logbook structure changes |
| `docs/INDEX.md` | Documentation router | Deep system behavior | Docs are added, moved, or archived |
| `package.json` | Package metadata and scripts | Runtime secrets | Package/script changes |
