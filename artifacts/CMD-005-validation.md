# CMD-005 verification — 2026-09-24

- 36 core/API/MCP/primer tests passed (178 assertions).
- Four primer tests execute the exact published Bash block: independent initialization, CRUD, recovery, stale-head rejection, invalid references, broken deletions, unsafe paths and checked-out-branch refusal.
- Planning operations preserve source HEAD, staged index, dirty files and untracked code. Temporary Git indexes are cleaned up.
- TypeScript typecheck passed.
- 14 Python format tests and the example validator passed.
- Chromium browser test passed, including four simultaneous worktrees and UI CRUD/conflict handling.
- Live Documentation view verified displaying the complete primer, including Git-only instructions and optional MCP/CLI/UI operations.

The published .command/docs/agent-primer.md matches AGENT_PRIMER.md in code commit 7fb47f06ffcf31f3456e45ceefb6c9bb75c8985d. MCP is implemented and tested, not automatically installed in an agent client. No remote push was performed.
