# Status

## Active-Stack State

The design folder now separates active-stack implementation facts from old build history.
`ground-truth.md` is the source of truth for active-stack behavior. The docs PR commit is
docs-only, so it does not contain every referenced code file. `trash/` contains the old
work-package notes and superseded streaming/session RFCs.

The code supports batch `/invoke`, Vercel-compatible `/messages` streaming, and a
`/load-session` route shell. The runtime is still cold and replay-based. Durable session
history is not implemented. Harness session snapshots are not designed yet.

## Progress Log

- Moved historical `scratch/` material to `trash/`.
- Moved old streaming/session RFCs to `trash/old-rfcs/`.
- Added active-stack `ground-truth.md`, `protocol.md`, and `implementation-review.md`.
- Added meeting-alignment, agent-template, and triggers pages to capture the June 18 design
  intent that was not reflected in the active-stack docs.
- Rewrote the top-level README, architecture, ports/adapters, and sessions pages around the
  active-stack code.
- Narrowed current-state docs so old work-package labels stay in archive pages or pending
  cleanup notes.

## Decisions

- Top-level docs describe active-stack behavior, not the docs PR's isolated tree.
- Future or blocked work must be labeled as planned, blocked, experimental, or not
  implemented.
- Runtime/sandbox selection is still part of the POC request shape, but it is not durable
  agent template identity unless we decide that explicitly.
- `sdk-local-tools/` remains top-level because it describes a partly implemented tool
  organization and resolver effort. It is blocked by `LocalBackend`, not obsolete.
- `trash/` is historical. It is not design truth.

## Blockers

- `LocalBackend` is still a stub.
- `SessionStore` has no production adapter and completed turns are not persisted.
- There is no future-facing session snapshot port for Rivet/ACP or harness state.
- Trigger lifecycle and event-to-agent mapping are not implemented.
- `AgentaHarness` still uses placeholder product content and only works on the in-process
  Pi path.
- MCP and HITL are visible in the protocol/config surface before the full runtime support is
  finished.

## Open Questions

- Should `LocalBackend` remain exported before it is implemented?
- Should MCP controls be hidden or constrained by selected harness/backend?
- Should `agenta` be hidden from non-local sandbox selections?
- Which storage backend should own agent session history first?
- What is the Rivet/ACP session representation, and does it belong in Postgres, object
  storage, or a separate session store?
- Should sandbox/runtime remain user-selectable after the POC, or become deployment
  infrastructure only?
- What is the persisted agent template DTO that separates `AGENTS.md`, skills, tools,
  harness config, and runtime selection?
- Do triggered runs always create a new session, resume one from the event, or use a
  configured mapping?

## Next Steps

1. Run the stacked PRs suggested in `pr-stack.md`.
2. Decide whether to implement or hide `LocalBackend`.
3. Define the agent template DTO and config layering before persisting templates.
4. Build durable sessions before promising reloadable `/messages` conversations.
5. Research session snapshot representation before designing warm/stateful resume.
6. Build the trigger POC behind a port-and-adapter boundary.
7. Productize or hide the experimental Agenta harness.
