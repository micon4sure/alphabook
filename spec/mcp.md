# Optional MCP planning adapter — draft, not an implemented server

**Files plus Git are the entire system.** MCP is a convenience for accessing and
editing project planning. It is never required to read a project, update a task,
track worktrees or commit changes. Command Center can read/write the same files
directly through its local file operations.

MCP exposes context and tools; ACP connects editors/clients with coding agents.
RPF defines portable records. Official references inspected 2026-09-24:
[MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture) and
[ACP overview](https://agentclientprotocol.com/protocol/overview).
The eventual adapter uses an existing supported MCP SDK/revision. The file format
does not prescribe a new transport or an agent execution system.

## Planning tools

| Tool | Purpose |
| --- | --- |
| `list_projects`, `list_worktrees` | Registered repositories and local checkout context. |
| `read_project` | Manifest, selected checkout/ref, HEAD and dirty state. |
| `list_tasks`, `read_task`, `write_task` | Task metadata and Markdown in the selected snapshot. |
| `list_decisions`, `read_decision`, `write_decision` | Decision records with the same semantics. |
| `read_document`, `write_document` | Project planning documentation under `.command/`. |
| `list_task_commits` | Trailer associations reachable from an explicitly selected ref. |
| `validate_project` | Schema, references, dependency graph and path diagnostics. |
| `commit_planning_changes` | An ordinary commit of explicitly selected planning edits. |

Read-only resources may expose the same records. Mutations name the registered
project AND checkout, expected file revision and new content. Direct file edits
and UI changes follow the same validation rules and appear on the next refresh.

A planning operation may optionally request a commit after writing, or commit its
selected changes explicitly. Both use ordinary Git, include relevant Task trailers,
and return the commit OID. Only the intended `.command/` changes are included;
unrelated staged files and dirty code must not be swept into that commit.
A write succeeding but commit failing is reported as saved, uncommitted progress,
not as a rolled-back or completed commit.

MCP does not implement source code, run agents, merge task branches or own project
state. An implementing agent can instead change code and task files directly and
commit them together. GitHub integration is optional.

Local registration controls repository access. Remote authentication belongs to
the adapter deployment; portable records contain no host paths, credentials or
agent session secrets. An adapter that is offline has no effect on ordinary
file/Git operation or Command Center's ability to display the project.
