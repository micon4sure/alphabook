# CMD-006 verification — 2026-09-24

- 32 core/API/MCP tests passed (134 assertions).
- TypeScript typecheck passed.
- 14 independent Python format tests passed.
- Chromium browser test passed: four simultaneous active worktrees, central plan, UI CRUD, stale-edit conflict, external Git refresh, Markdown sanitization, desktop/mobile layouts.
- Two independent CLI writer processes: exactly one succeeds on the same expected head; no silent overwrite.
- Staged/dirty/untracked code, code HEAD and code index preserved by planning CRUD.
- Bare repository reads require no checkout. Initializing creates no sibling directory.
- Explicit migration tested for backup recovery and unrelated staged-code preservation.

This repository migrated to an independent command root; only .command is present there. The old code history was not rewritten. Original working records remain at .git/command-migration-backup-jma0Wz/.command. There is still exactly one worktree; no planning checkout was created.

Code commit: e4b3d0f45e0e7efec6d90cce88bb6360a7bb70c6

The live app was reloaded and the shared command dashboard verified. Old services on 4310/5173 were not changed. The primer is tracked separately as CMD-005.
