# Command

Build a small project-management application over the repository-owned format in
`spec/0.1.md`. Read that draft and `.command/project.yaml` before changing behavior.
The format is experimental; revise it from implementation evidence. Keep the
specification usable independently of Command Center.

Project files are the source of truth. Git supplies history and branch context.
Explicit project/worktree selection is required for writes. Never mix another
checkout's files with the selected checkout's HEAD or task state. Keep credentials,
checkout paths and caches outside tracked project records. Files plus Git must
work without MCP, a daemon, a database or a claim/coordination service.

Scope: planning, task graphs, decisions, documentation, artifacts, Git links and
optional MCP planning edits/commits. MCP edits `.command` planning files; code
implementation remains with existing agent tools. Preserve the old
Command Center and existing project repositories during development.

Use relevant verification, update this repository's `.command` records, and make
a real Git commit after each completed task. Include `Task: <id>` trailers. Do not
push or publish without a request. Do not spawn agents unless explicitly requested.
