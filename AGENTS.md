# Command

Build a small project-management application over the repository-owned format in
`spec/0.2.md`. Read that draft and the manifest on the command branch before changing behavior:
`git show command:.command/project.yaml`. During an explicit 0.1 migration, the
old code-root `.command` is the source until the orphan branch has been created.
The format is experimental; revise it from implementation evidence. Keep the
specification usable independently of Command Center.

Project files are the source of truth. Git supplies history and branch context.
The full `.command` tree lives only on the orphan command branch. Code worktrees
do not carry task databases. Do not create a sibling planning checkout: read and
write Git objects directly, with an isolated index and expected-ref checks. The
UI, CLI and optional MCP share one validated writer. Keep credentials,
checkout paths and caches outside tracked project records. Files plus Git must
work without MCP, a daemon, a database or a claim/coordination service.

Scope: planning, task graphs, decisions, documentation, artifacts, Git links and
optional MCP planning edits/commits. MCP edits `.command` planning files; code
implementation remains with existing agent tools. Preserve the old
Command Center and existing project repositories during development.

Use relevant verification, update this repository's command-branch records, and
make real commits after each completed task. Code changes are committed on their
code branch, then planning status/evidence/code hashes are committed to command.
Include `Task: <id>` trailers. Read AGENT_PRIMER.md for setup, Git-only CRUD and
concurrency rules. Do not merge command into code history or vice versa. Do not
push or publish without a request. Do not spawn agents unless explicitly requested.
