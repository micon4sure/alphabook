# Alphabook

**Minimalistic, accessible, machine-readable project planning.**

Alphabook keeps your tasks, decisions, documentation and artifacts in Git,
connected to the code they describe. A small web app makes the plan easy to
browse and edit. Plain Markdown and structured YAML make it readable by people,
agents and other tools.

Your plan belongs to your repository. No database, hosted account or MCP server
is required. Use the web UI, CLI, optional MCP interface, or just files and Git.

## Get started

You'll need **Bun 1.4+** and **Git** with your author name and email configured.

```sh
git clone https://github.com/micon4sure/alphabook.git
cd alphabook
bun install --frozen-lockfile
bun start
```

Open [localhost:4320](http://127.0.0.1:4320).

To start planning an existing Git project, run this from the Alphabook directory
in another terminal:

```sh
bun run alphabook init /absolute/path/to/project "My project"
```

This creates its planning branch and registers it with the app, without changing
the project's code. Create tasks, set dependencies, record decisions and attach
documentation through the dashboard.

Already have an Alphabook plan? Use **Register project** in the UI, or:

```sh
bun run alphabook register /absolute/path/to/project
```

After cloning a project with an existing plan, create its local planning branch
before registering it: `git branch --track alphabook origin/alphabook`, run inside
that project's checkout. This does not switch your code branch.

## One project, one shared plan

Code stays on your normal branches. Planning lives on a separate `alphabook`
branch in the same repository, with its own history:

```text
alphabook branch
├── project.yaml
├── tasks/
├── decisions/
├── docs/
└── artifacts/
```

All code worktrees share this plan. One person in a single checkout or several
agents in separate worktrees can track their work in the same dashboard. Tasks
link to code branches and commits; dependencies show what's ready to start.

Connect a code commit to a task with a Git trailer:

```sh
git commit -m "Add project search" -m "Task: T-001"
```

Alphabook reads the planning branch directly—no extra checkout is needed. Edits
through the UI, CLI or MCP become validated Git commits. Conflicting writes are
rejected so another contributor's changes aren't silently overwritten.

Push and fetch the planning branch alongside your code to share both. Any Git
remote works; GitHub is optional. Planning and code histories stay separate.

## For agents and tools

The [agent primer](AGENT_PRIMER.md) covers registration, task planning, worktrees,
code links and plain-Git reading and editing. The [1.0 format](spec/1.0.md) and
[JSON Schema](schemas/1.0/schema.json) let other tools read and write the same plan.

MCP is an optional convenience layer for querying tasks and editing planning
files. It does not run agents or require the web app. For a stdio MCP client:

```json
{
  "mcpServers": {
    "alphabook-planning": {
      "command": "bun",
      "args": ["/absolute/path/to/alphabook/apps/mcp.ts"]
    }
  }
}
```

See the [MCP interface](spec/mcp.md) and [worktree workflow](spec/worktrees.md)
for details.

## Configuration

- `ALPHABOOK_PORT`: web port, default `4320`.
- `ALPHABOOK_HOME`: local registration directory, default `~/.local/share/alphabook`.

The app is for local use and binds to `127.0.0.1`. It is not an authenticated
public server. It never automatically fetches, pushes or executes project code.

## Contributing and license

See [Contributing](CONTRIBUTING.md) for development setup and tests.

Alphabook is [MIT licensed](LICENSE). The bundled DINish font uses the
[SIL Open Font License](apps/web/fonts/DINish-OFL.txt).

By [Techtile](https://techtile.media).
