# Command

A new local Command Center for planning and tracking projects in their own Git
repositories. This repository currently contains the first **experimental format
draft**, schemas, fixtures, validators, a shared TypeScript file/Git reader and a
working local web application and an optional read-only MCP query adapter.

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

## Run Command Center

Install Bun 1.4, then from this repository:

```sh
bun install --frozen-lockfile
bun start
```

Open <http://127.0.0.1:4320>. Register an absolute Git checkout path (or its
`.command` directory). An RPF 0.1 manifest must already exist. Registration never
copies code or migrates legacy `.command` formats. The app reads local files and
local Git refs; it does not fetch, push, merge, run agents or change planning files.
Use ordinary file tools to edit records and ordinary Git to commit them.

The **Accepted plan** view reads the registered integration branch's committed
tree. **Checkout files** reads the selected worktree, including uncommitted edits.
The Worktrees section compares recorded progress; it does not claim to detect
running agents. Changes refresh every four seconds while the page is visible.
Binary artifacts are listed; textual artifacts can be previewed.

`COMMAND_PORT` changes the port. The app binds only to `127.0.0.1`; it is a
trusted-local-user tool, not an authenticated remote deployment. Host/origin
checks and write headers guard local browser access. Do not expose it publicly.
Assets are bundled on startup, so restart the new app after changing its code;
planning file changes never require a restart.

For this development checkout, a separate transient user service keeps the app
alive independently of the terminal. It is not configured to start after reboot:

```sh
systemctl --user status command-center-preview
journalctl --user -u command-center-preview -n 50
systemctl --user restart command-center-preview
systemctl --user stop command-center-preview
```

This service is separate from the old Command Center on ports 4310/5173.

## Optional MCP service

Run `bun run mcp`, or configure a stdio MCP client to launch the entrypoint:

```json
{
  "mcpServers": {
    "command-planning": {
      "command": "bun",
      "args": ["/absolute/path/to/command/apps/mcp.ts"]
    }
  }
}
```

Adapt the enclosing configuration key to your client. If the client does not
inherit your shell's PATH, replace `bun` with the absolute result of `command -v
bun`. Use the same `COMMAND_HOME` environment value as the web app if you override
the registry location. The client starts the stdio process; no HTTP MCP endpoint
or separately running web server is needed. No client settings are modified by
installing Command.

Start with `list_projects`, then `list_worktrees`. Pass the returned local
`projectId`, `checkoutId` and explicit `source` (`checkout` or `accepted`) to
`list_tasks`, `read_task`, `read_project`, decision/document queries or validation.
`list_tasks` defaults to open tasks; `filter: "ready"` checks dependencies.

All 11 current tools are read-only. Planning edits and commits use ordinary file
and Git tools for now; MCP mutation tools are a documented future extension.
See [the tool contract](spec/mcp.md).

## Validate the draft fixtures

The shared application core can be verified with Bun 1.4:

```sh
bun install --frozen-lockfile
bun test tests/core.test.ts tests/server.test.ts tests/mcp.test.ts
bun run typecheck
bun run test:browser
```

It keeps registrations in `COMMAND_HOME/projects.json` (by default
`~/.local/share/command/projects.json`), outside managed repositories. A project
UUID identifies shared planning history; a Git common-directory identity
distinguishes local clones and deduplicates linked worktrees. Registration records
the integration branch; re-register after deliberately changing that branch.

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

The application reader currently handles local checkouts, files up to 2 MiB and
folder scans up to 5000 files. Accepted snapshots do not follow Git symlinks.
Large/binary artifacts should be kept in appropriate external storage or Git LFS;
the viewer is not an artifact hosting service. Relative Markdown links and images
are not followed in previews; repository contents cannot load scripts or remote
images. Git operations have a 10-second timeout. These are implementation limits,
not requirements of the portable format.

## Towards a useful public format

Keep 0.1 small, build Command and an MCP adapter against it, collect independent
implementation feedback, and change the draft where practical use reveals gaps.
Versioned schemas and common fixtures should make interoperability testable.
Publishing, a final name and a stable release can follow that evidence.

See [CONTRIBUTING.md](CONTRIBUTING.md). New code and specification material are MIT
licensed. The visual palette and controls follow the existing Command Center;
the bundled unmodified DINish font retains its [SIL Open Font License](apps/web/fonts/DINish-OFL.txt).
No old application logic, project data or layout has been imported.
