# agent-client-tool-cleanup

Planning workspace for: make `client` tools (browser-fulfilled, e.g. `request_connection`) work
on the **Claude** harness — not Pi only — with a fail-loud guarantee against silent drops, and
fold in the cleanups the merged PR #4936 left behind (duplicated helpers, a dead second park
path, an off-contract render hint).

This started as a staff review of PR #4936; the user asked for ONE unified cleanup plan to review
and iterate on before any code.

## Files

- `plan.md` — the reviewable plan: the Claude delivery mechanism, 5 phases (safety → consolidate →
  one park seam → Claude feature → polish), risks, and a test/verification section. **Start here.**
- `research.md` — the evidence base: how client tools work today, why they're Pi-only, the
  dead-vs-live park paths, the duplication, the RenderHint drift, with exact `file:line` refs.

## Headline

Mechanism (Codex-reviewed): deliver client tools to Claude over the existing internal loopback MCP
server and **park inside the MCP `tools/call` handler** via a single shared `buildClientToolRelay`
seam that the Pi file-relay loop also uses. The crux: a parked call emits **NO MCP tool result** —
the handler deterministically aborts its own in-flight HTTP request (plus an engine `AbortSignal`)
so Claude can't settle/clobber the pending widget before the paused turn is observed. Correlation
attaches the widget to Claude's real tool-call id (name+args is the cold-replay fallback);
client-tool outputs get their own resume store (FIFO, separate from approvals). Phase order:
typed `connect` → schema cleanup (incl. the tool-mcp-http empty-schema bug) → extract the shared
seam → implement Claude → **delete the dead permission branch last**.

No interim stopgap gate for local Claude — build the real path directly. One permanent, honest
guard for **Claude + Daytona** (loopback MCP is skipped there), flagged for the owner to confirm.

## Status

DRAFT (revised after Codex xhigh review) — awaiting owner review of `plan.md`. No code, nothing
committed.

## Decisions baked in

- `render: {kind: "connect"}` → first-class typed `RenderHint` member.
- Required-field validation stays on for client tools (fix is schema authoring, not special-casing).
- Rename `publicToolSpecs` → `advertisedToolSpecs`.
