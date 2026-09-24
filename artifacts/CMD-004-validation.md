# CMD-004 verification — 2026-09-24

- `bun test tests/mcp.test.ts`: 5 passed, 31 assertions.
- `bun run typecheck`: passed.

Tests launch `apps/mcp.ts` as a real stdio child process and connect the official
MCP SDK client. No web server is started. They check tool discovery and read-only
annotations; project resource access; open/ready tasks; records, docs and commits;
external file edits; distinct checkout versus accepted task state; invalid IDs,
missing context, traversal attempts and limits; validation errors suppressing
false ready results. Test fixtures and MCP child processes are cleaned up.

The service is implemented and callable, not installed into any agent/client
configuration. README documents stdio setup. Planning writes/commits are clearly
identified as future capabilities; ordinary file/Git operations work now.
