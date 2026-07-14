# Agent mounts

One durable folder per agent, derived from the workflow artifact id. No schema change, no
configuration, no wire change. Decided 2026-07-11 (Mahmoud + JP); this workspace is the
design and execution plan.

## Files

- `context.md`: why the work exists, the decision and its alternatives, goals, non-goals.
  Read this first.
- `research.md`: the code facts the design stands on, with file:line pointers (slug
  mechanism, table shape, wire fields, runner plumbing, the frontend discovery gap).
- `plan.md`: design decisions D1-D4, the four slices, tests, and the open questions to
  settle in PR review.
- `status.md`: current state; kept up to date as slices land.

## Related

- `docs/design/agent-workflows/projects/runner-selfhosting-explainer/mounts-design-notes.md`:
  the conversation notes this project came from (mount taxonomy, future project mounts).
- `docs/design/agent-workflows/projects/harness-session-resume/`: JP's #5197, which built
  the transcript-mounts pattern the runner slice copies.
- `docs/design/mount-file-viewer/`: the frontend file browser the web slice reuses.
