# CMD-001 validation — 2026-09-24

Passed:

```sh
python3 tools/validate.py .
python3 tools/validate.py examples/minimal
python3 -m unittest discover -s tests -v
```

Both repository examples validate. All 14 tests pass. They cover YAML 1.2 core
scalars and rejected ambiguous constructs, version/metadata validation, filename
identity, missing references, task/decision cycles, path traversal, missing
artifacts, symlink escape and single-repository/worktree semantics.

The worktree test creates a temporary real Git repository, commits a plan, creates
a task worktree, marks work in progress and then done, and commits code plus task
updates with Task trailers. Main remains planned until a fast-forward integration
brings both code and the completed task into its tree. It uses only files and Git.

This verifies the draft's examples and that basic Git workflow. It does not claim
an implemented Command Center UI, MCP adapter, live worktree dashboard, concurrent
writer coordination, conflict resolution or scheduling of 17 actual agents.
