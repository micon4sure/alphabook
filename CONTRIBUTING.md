# Contributing to the draft

The specification is experimental. Propose changes with a concrete use case, a
schema/example change and its interoperability consequences. Keep application UI
preferences separate from portable record semantics. No existing tool must adopt
Alphabook to implement the format.

Versioned draft specifications and schemas live under `spec/` and `schemas/`.
Report implementation experience, especially from independent readers/writers and
parallel worktree workflows. Fix misleading requirements before freezing a stable
version; do not equate a document marked 1.0 with ecosystem adoption.

Run the reference validator and tests when changing the format. New edge cases
should become small interoperability fixtures, not requirements for an entire
agent orchestration platform. Discussion and contributions will use the public
repository once its owner chooses to publish it; no remote is configured yet.
