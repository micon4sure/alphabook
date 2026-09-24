# CMD-003 verification — 2026-09-24

- `bun test tests/core.test.ts tests/server.test.ts`: 21 passed, 68 assertions.
- `bun run typecheck`: passed.
- `bun run test:browser`: Chromium end-to-end test passed.
- Inspected desktop (1440px) and mobile (390px) screenshots: no page overflow,
  readable records and controls, responsive stacked detail layout.
- Registered this repository through the actual local app; observed its tasks,
  decisions, linked commit and accepted main-branch snapshot.

Browser test covers project registration, all sections, keyboard graph navigation,
linked commits, separate worktree/accepted completion state, automatic refresh of
external file edits, Markdown script/image sanitization and inherited typography.
HTTP tests cover host/origin checks, explicit registration write headers and
absence of arbitrary file-serving endpoints.

New app is on loopback port 4320 under a separate user service. Existing old app
processes on ports 4310 and 5173 were preserved. No legacy project was migrated.
Only the new Command repository was registered in the new machine-local registry.
