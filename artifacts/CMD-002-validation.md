# CMD-002 verification — 2026-09-24

- `bun test tests/core.test.ts`: 17 passed, 47 assertions.
- `bun run typecheck`: passed.
- `python3 -m unittest discover -s tests -v`: 14 passed.

Tests create disposable repositories, clones and linked/detached worktrees.
They cover file-only external changes; separate accepted/worktree task state;
ordinary integration of code and planning; actual Git trailer parsing; unborn
HEADs; registration deduplication and clone identity; missing references, cycles,
artifacts and duplicate IDs; strict YAML; path and symlink escapes.

Implementation limits: local checkouts only, files up to 2 MiB, directory scans
up to 5000 files, Git operations bounded to 10 seconds. Accepted snapshots do not
follow Git symlinks. Commit queries scan the latest 100 commits and disclose
truncation. No remote fetch, writes to project files, migration, claims or database.
