# Single checkouts and worktrees — draft 0.1

A project works in one checkout with ordinary file edits and Git commits. Multiple
worktrees extend that same model. No MCP server, agent runner, claim service or
central database is required.

## The two views

Each worktree has its own code and `.command/` files. The common Git repository
provides branches, objects and history. Discover local worktrees with
`git worktree list --porcelain` and resolve `git rev-parse --git-common-dir`;
`.git` may be a file, not a directory.

The accepted plan comes from the declared integration branch. A worktree supplies
its own proposed tasks, decisions, docs and code. Interfaces MUST distinguish
accepted state from branch state and show the branch/HEAD and uncommitted changes.
A task marked done only on an agent branch is **ready to integrate**, not accepted
as done project-wide until the integration branch contains it.

With one checkout, the same distinction is simply committed state versus working
changes. An unborn integration branch has no accepted snapshot yet.

## Tracking work without a service

An agent or user marks a task `in_progress` in its worktree's task file. Optional
`assignee` text can identify who is working on it. This can be an ordinary editor
change or a small planning commit. No MCP notification is needed.

Command Center reads those files across the registered worktrees and shows which
tasks each branch is working on, along with dirty state and associated commits.
If two worktrees claim the same task, it reports the overlap. A task status or
assignee field is descriptive; neither is an exclusive global lock or proof that
an agent process is currently alive.

After a restart, the same view can be rebuilt from files and Git. Personal checkout
locations and presentation preferences live in local app configuration, not in the
portable planning files.

## Working and integrating

1. Plan tasks and dependencies on the integration branch.
2. Give independent tasks to agents in their own worktrees using existing tools.
3. Each agent edits code and its task record, records relevant verification and
   commits with `Task: <id>` trailers. Planning-only changes can be separate commits.
4. Show branch completion as a proposal to integrate. Dependencies are evaluated
   within that branch's snapshot; the dashboard also shows accepted-plan progress.
5. Bring branches together through ordinary merges, rebases, cherry-picks or pull
   requests. Resolve overlapping source/task changes and run relevant checks on the
   combined result. Update the integration branch, then refresh the accepted view.

The plan graph does not guarantee that two tasks touch different files. Tools MUST
surface conflicts rather than silently combining incompatible task states.
An integration tool should compare the target branch's expected tip before updating
it. This draft does not implement a merge queue or impose a human approval gate.

Stable IDs, rather than task titles, survive branches and renames. UUID-based IDs
permit independent additions; short numeric IDs require coordination or explicit
resolution if two agents choose the same ID.

Every writing interface must explicitly select its checkout and compare the
expected record revision. Never infer the correct worktree from project UUID alone.

Optional scheduling/leases could later coordinate exclusive assignment, including
across machines. They are not part of the 0.1 baseline. Independent clones only
share changes after normal Git exchange; the UI must not imply a global live view
when it can see only local worktrees.
