# Command

A new local Command Center for planning and tracking projects in their own Git
repositories. This repository currently contains the first **experimental format
draft**, schemas, fixtures and a read-only validator. The application and MCP server
are next; neither is implemented yet.

The working name **Repository Project Format (RPF)** is provisional. The goal is
an openly implementable format that other tools can read and write. This is a
proposal, not an adopted industry standard or a stable 1.0 commitment.

## Separation

- This Git repository holds the Command application and the draft specification.
- Each managed project keeps its own code and `.command/` files in its own Git repo.
- Command registers existing checkout locations locally and reads their current
  files. Any index/database is a disposable cache.
- Worktrees share project identity but have independent files, branches and HEADs.
  The default dashboard separates the accepted integration-branch plan from each
  task branch's proposed progress.
- A normal editor or another compatible tool can maintain the files without
  Command or MCP. An optional MCP adapter edits planning files and can commit
  those edits using ordinary Git. No coordination server is required.

```text
project/
  src/
  .command/
    project.yaml
    tasks/T-001.md
    decisions/D-001.md
    docs/
    artifacts/
```

Task-related commits carry `Task: T-001` trailers. Code and task changes can be
committed together; planning-only edits can have their own commits. Git history
supplies the task-to-commit mapping; task files
do not contain their own commit hash. GitHub is an optional remote.

Read [the draft](spec/0.1.md), [worktree workflow](spec/worktrees.md),
[MCP mapping](spec/mcp.md), and [schema](schemas/0.1/schema.json).
`examples/minimal` is a portable example; `.command/` tracks this repository itself.

## Validate the draft fixtures

Python 3.10+ and the dependencies in `requirements-dev.txt` are needed only for
the reference validator. Implementations of the format may use any language.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python tools/validate.py .
.venv/bin/python tools/validate.py examples/minimal
.venv/bin/python -m unittest discover -s tests -v
```

The validator checks the current files, schema and references. It does not change
files, assign work, implement Git integration or run an MCP server. A directory
with no valid manifest is reported as unsupported; existing legacy `.command`
formats must be explicitly migrated later.

## Towards a useful public format

Keep 0.1 small, build Command and an MCP adapter against it, collect independent
implementation feedback, and change the draft where practical use reveals gaps.
Versioned schemas and common fixtures should make interoperability testable.
Publishing, a final name and a stable release can follow that evidence.

See [CONTRIBUTING.md](CONTRIBUTING.md). New material in this repository is MIT
licensed; no existing project contents have been imported.
