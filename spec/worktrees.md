# One shared plan, many code worktrees — draft 0.3

The planning branch is `alphabook`. It has independent history and contains only
project.yaml, tasks/, decisions/, docs/ and artifacts/ at its root. There is no
dot-folder. Code branches contain code. Main/master naming does not affect
planning; no branch is renamed by Alphabook.

The dashboard always displays this shared plan plus all locally visible code
worktrees and branches. It has no project-wide checkout selector. Task records
link to work with `branches` and optional full `commits` IDs. Four agents in four
code worktrees can each have a task marked in progress in the same plan.

## Working

1. Plan tasks and dependencies on alphabook.
2. Create code worktrees using ordinary Git and the project's existing code base.
3. Update each task on alphabook: status, assignee and code branch names.
4. Implement and test in the code worktree. Commit code with Task trailers.
5. Update the central task with evidence and code commit IDs. Use review while
   awaiting review/integration, and done when its acceptance criteria are met.
6. Integrate code using the project's normal workflow. Never merge alphabook into
   a code branch or a code branch into alphabook.

Task state is explicit recorded information, not process monitoring. Several
branches can be linked to one task; use separate tasks when separate statuses are
needed. Names/IDs remain meaningful even when a branch is absent locally. Missing
branches/objects are warnings, not invented live activity.

## No planning checkout required

Readers use Git objects at an exact alphabook commit. Writers use an isolated
temporary index inside the common Git directory and publish a new planning commit
with an expected-old-ref check. The code checkout, code index and branch are not
changed. No sibling folder or daemon is needed.

MCP and the UI wrap this same Git workflow. The CLI and the plain-Git instructions
in the agent primer work without them. An optional alphabook checkout is supported
for ordinary file editing; direct-ref writers refuse while alphabook is checked
out, rather than leaving that checkout stale.

## Parallel agents and machines

All linked worktrees share refs through the common Git directory. Multiple writers
must read a current planning revision and handle compare-and-swap conflicts.
Re-read/reconcile after a conflict; do not retry by overwriting the newest state.
Task assignment is not an exclusive lease.

Separate clones do not share live state. Fetch and push both alphabook and code
branches explicitly. Reconcile divergent alphabook histories as ordinary Git
changes; no force push, last-writer-wins syncing or hidden merge queue is supplied.

The observer discovers local worktrees with `git worktree list --porcelain` and
resolves `git rev-parse --git-common-dir`; a worktree's .git may be a file.
Missing/prunable worktrees remain visible as unavailable. Detached code checkouts
can be associated through an exact recorded HEAD commit. A bare repository can
still expose the complete planning tree without any checkout.
