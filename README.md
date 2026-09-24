# Command Center

A small local planning app. One shared plan on an **orphan `command` branch**;
code stays on the repository's normal branches. The dashboard shows all code
worktrees together. No planning checkout or sibling directory is required.

**Agents: start with [AGENT_PRIMER.md](AGENT_PRIMER.md).** It covers initialization,
registration, task planning, worktrees, plain-Git CRUD, MCP and finishing work.

## Run

Requires Bun 1.4 and Git with a configured author identity for writes.

```sh
bun install --frozen-lockfile
bun start
```

Open <http://127.0.0.1:4320>. Register an absolute repository path that already has
an RPF 0.2 command branch, or initialize a new plan using the CLI/MCP. No code is
copied, moved or renamed by registration.

```sh
bun run command init /absolute/project "Project name"
bun run command register /absolute/project
bun run command projects
bun run command show LOCAL_PROJECT_ID
bun run command validate LOCAL_PROJECT_ID
```

Initialization creates only a metadata root commit and local registration; it
never switches code HEAD or adopts an existing .command folder. It refuses to
replace command. Existing projects need an explicit migration, not reinitialization.

## Model

The same Git repository has two independent histories:

- Code branches: source, builds and code commits, with `Task: T-001` trailers.
- `command`: `.command/project.yaml`, tasks, decisions, docs and artifacts.

Task records name their code branches and optionally full code commit IDs. The
dashboard combines that single plan with observed branch/HEAD/dirty state from
all local worktrees. Status is recorded information, not live agent monitoring.
`main`/`master` names do not matter to planning and are never renamed.

The app reads committed command objects directly. Every UI/MCP/CLI planning edit
validates the candidate complete plan and commits to command. Expected file
revision and branch-tip checks prevent silently overwriting concurrent edits.
Code files, code HEAD and the real code index are untouched. Plain Git can perform
the same CRUD operations; see the primer. Never merge code and planning histories.

Changes refresh every four seconds while the page is visible. The UI supports
creating, editing and deleting records/docs; Git retains deleted content. Prefer
cancelling historical tasks. Binary or LFS payloads are listed without pretending
a pointer is the actual artifact.

## Optional MCP

The MCP interface is part of this application, not a separate source of truth.
Run `bun run mcp`, or have a stdio client launch it. The web server need not run.

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

Adapt the enclosing config to your client. Use an absolute Bun executable path if
the client's PATH differs. Both interfaces use the same COMMAND_HOME value.
There is no public HTTP MCP endpoint. No agent/client configuration is modified
automatically.

There are 11 query tools and 6 mutation tools. Start with list_projects/read_project;
no worktree selection is needed to read the plan. Write tools accept the exact
command HEAD and file revision returned by a read. Conflicts require a fresh read
and reconciliation, not force-overwriting. [Tool contract](spec/mcp.md).

## Local state and service

Registrations live in COMMAND_HOME/projects.json, default
~/.local/share/command/projects.json. They are machine-local paths, not project
records. UUIDs identify projects; common Git directories distinguish local clones
and deduplicate linked worktrees.

COMMAND_PORT defaults to 4320. The app binds only to 127.0.0.1 with host/origin
checks. It trusts the local user; it is not an authenticated public deployment.
Do not expose it publicly. Nothing automatically fetches, pushes or runs agents.

This development instance uses a separate transient user service:

```sh
systemctl --user status command-center-preview
journalctl --user -u command-center-preview -n 50
systemctl --user restart command-center-preview
```

It survives terminal closure, but is not enabled for reboot. Restart after app code
changes because assets are bundled on startup. Planning commits need no restart.
The old Command Center on ports 4310/5173 is separate and untouched.

## Verification and limits

```sh
bun run typecheck
bun test tests/core.test.ts tests/server.test.ts tests/mcp.test.ts
bun run test:browser
python3 -m unittest discover -s tests -v
python3 tools/validate.py examples/minimal
```

Python's requirements-dev.txt is only needed for the independent file validator.
That validator reads a directory of planning files; the CLI validates the live
Git branch. The example is a planning tree, not a code checkout layout.

Current reader bounds: 2 MiB per file, 5000 files per scanned folder, 10-second Git
operations. Commit scans expose truncation. Planning symlinks/submodules are
rejected. Only text CRUD is supported by the convenience writer. Plain Git can
store binary artifacts. Previews sanitize HTML and do not load remote images.
Direct-ref writers refuse while command is checked out anywhere in the repository.

## Format and migration

[Draft 0.2](spec/0.2.md), [schema](schemas/0.2/schema.json),
[worktrees](spec/worktrees.md), [MCP](spec/mcp.md).
RPF is a provisional name; this is experimental, not an adopted/stable standard.

For this application's earlier 0.1 layout, the explicit migration helper is:

```sh
bun tools/migrate-command.ts /absolute/repository
```

It creates an orphan command history, preserves the project UUID, moves original
planning files to a recovery directory inside the Git common directory, and stages
their removal from the code branch. Review and commit those deletions normally.
It refuses existing command branches, staged planning edits and binary/symlink
input. It never publishes remotely or rewrites existing code history. This is not
a converter for unrelated legacy Command Center formats.

New code/spec material is MIT licensed. The existing Command Center supplied only
the visual palette/control styling and unmodified DINish font, whose
[SIL Open Font License](apps/web/fonts/DINish-OFL.txt) is included.
