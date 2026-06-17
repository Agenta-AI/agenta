# Status

Source of truth for this design effort. Keep it current.

## Current state

Research and proposal drafted (2026-06-17). Nothing implemented. The comparison is in
[`research.md`](research.md); the recommended shape and phased path are in
[`proposal.md`](proposal.md). This builds on the shipped WP-8 runtime
([`../wp-8-rivet-acp-runtime/status.md`](../wp-8-rivet-acp-runtime/status.md)), which
adopted rivet unmodified and kept the ports unchanged on purpose.

## Recommendation in one line

Evolve the ports in phases (A: capabilities + structured result, B: event streaming,
C: first class sessions, D: content blocks + permissions + skills + hooks, E: retire the
`Runtime.exec` port), keeping rivet behind the seam and `/invoke` working at every step.

## Decisions taken

| Decision | Rationale |
| --- | --- |
| Keep a neutral port; rivet stays one adapter behind it | Legacy Pi path and future non rivet harnesses still fit; avoids the port becoming a rivet wrapper |
| Split the port into Environment (plane A) and AgentSession (plane B) | Matches rivet's own split; our single `invoke` collapses both today |
| System plane (fs/process/desktop) stays out of the harness port | It is provisioning, used only by the Environment adapter; never exposed to the agent author |
| Hooks are config artifacts, not a port verb | Rivet has no hook API; hooks live inside the harnesses, read from disk |
| Adopt a capability model over `if harness == "pi"` | Rivet already probes `getAgent().capabilities`; removes brittle name checks |
| Structured result + event stream replace the single string | The data already flows through `runRivet.ts` for tracing; the port flattens it |

## User decisions (2026-06-17)

1. **Ambition: full A to E arc.** Plan all five phases, including first class sessions and
   retiring the `Runtime.exec` port. See [`plan.md`](plan.md).
2. **Session model: stay cold and replay.** Keep WP-8's one daemon per invoke. Do not
   stand up a warm daemon. This avoids the per session env channel and the folder jail.

### Reconciling "first class sessions" with "stay cold"

A warm daemon is the usual way to get ACP `session/load`. We are not doing that. So Phase
C gives a first class `AgentSession` object in the **port** backed by a persisted history,
and the adapter implements "continue" by **replaying persisted events into a fresh cold
sandbox** each turn (the WP-8 model, but the history lives in a persistence driver instead
of being passed in by the caller). The session abstraction is real and stable; the
continuation mechanism stays replay. ACP `session/load` is reserved for a future warm
daemon and is explicitly out of scope.

## Open questions (still need the user)

3. **Persistence ownership.** Where does the event history live: the backend DB on the
   platform, a file standalone, or rivet's own Postgres? Default assumption in
   [`plan.md`](plan.md): backend DB on the platform, file standalone, mirroring how WP-8
   framed the history store.
4. **Streaming at the HTTP edge.** Phase B streams events through the port but keeps
   `/invoke` request/response. A streaming endpoint (ties into WP-4 multi message output)
   is planned as a Phase B option, not a hard requirement. Confirm if wanted now.
5. **Fork.** ACP exposes `session/fork`. Plan treats it as a Phase C optional add for "try
   N variations of a turn". Defer unless there is a caller.

## Next step

Build plan is in [`plan.md`](plan.md). Phase A is the entry point. Open questions 3 to 5
do not block Phase A or B; settle them before Phase C.
