# CMD-007 verification — 2026-09-24

- 39 core/API/MCP/primer tests passed (186 assertions); TypeScript typecheck passed.
- 14 independent Python tests and the example validator passed.
- Chromium browser test passed: renamed branding, four worktrees, shared plan, CRUD, conflicts, safe Markdown and desktop/mobile layouts.
- Frozen-lockfile installation passed with unchanged dependency versions.
- Tested exact Git-only primer commands with project.yaml and record folders at branch root.
- Tests reject old branch/format/resource/write-header names; configuration and CLI use only Alphabook names.
- Live browser verified Alphabook title, project name, new installation path, alphabook plan and published primer.
- alphabook-preview is active, restart-on-failure, still transient (not enabled for reboot); the old preview unit is absent.
- Current planning tree contains only project.yaml, tasks/, decisions/, docs/ and artifacts/. No dot-folder, old branch alias or extra planning checkout.
- Project UUID and record IDs retained; prior planning tip remains an ancestor. Code history was not rewritten.
- DOMINATION repository untouched and its local registration retained unchanged. It requires a separate migration before the new reader can open its plan.

Code commit: d334bf311a5a98e62a26d15780997df122aa7169

Recovery: .git/alphabook-rebrand-backup-K2UFwe/before-rebrand.bundle is a verified complete Git bundle; projects.json preserves the previous local registration mapping. Existing older backups remain inside .git. The obsolete legacy migration helper was removed from current source but remains recoverable in Git history. No remote push or agent-client configuration change was made.
