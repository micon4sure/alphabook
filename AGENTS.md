# Alphabook

Build a small project-management application over the repository-owned format in
`spec/0.3.md`. Read that draft and the manifest on the alphabook branch before changing behavior:
`git show alphabook:project.yaml`.
The format is experimental; revise it from implementation evidence. Keep the
specification usable independently of Alphabook.

Project files are the source of truth. Git supplies history and branch context.
Planning files live directly at the root of the orphan alphabook branch, with no
dot-folder: project.yaml, tasks/, decisions/, docs/ and artifacts/. Code worktrees
do not carry task databases. Do not create a sibling planning checkout: read and
write Git objects directly, with an isolated index and expected-ref checks. The
UI, CLI and optional MCP share one validated writer. Keep credentials,
checkout paths and caches outside tracked project records. Files plus Git must
work without MCP, a daemon, a database or a claim/coordination service.

Scope: planning, task graphs, decisions, documentation, artifacts, Git links and
optional MCP planning edits/commits. MCP edits branch-root planning files; code
implementation remains with existing agent tools. Preserve the old
Command Center and existing project repositories during development. Do not add
legacy aliases or old-format compatibility. DOMINATION is not migrated yet.

Use relevant verification, update this repository's alphabook-branch records, and
make real commits after each completed task. Code changes are committed on their
code branch, then planning status/evidence/code hashes are committed to alphabook.
Include `Task: <id>` trailers. Read AGENT_PRIMER.md for setup, Git-only CRUD and
concurrency rules. Do not merge alphabook into code history or vice versa. Do not
push or publish without a request. Do not spawn agents unless explicitly requested.
