# Parkable gates: making Pi and client-tool approvals survive a turn

The design in this folder is judged by one invariant: whether a human answers an approval in
ten seconds or overnight, the sequence of LLM API calls should be identical. Call N ends with
the model returning a `tool_use`; call N+1 appends the real `tool_result` for that same id;
nothing is regenerated in between.

Keep-alive slice 2 gives one gate that property: the Claude ACP permission gate. Its parked
session still holds an answerable handle after the turn ends, so a click resumes the exact same
live tool call. The other three gates (the Pi custom-tool relay gate, the Pi builtin gate, and
the client-tool MCP pause) do not have that handle, so they fall to cold replay, where the
model re-issues a new call and the arguments can drift.

The 2026-07-09 kill-and-resume experiments
([report](../../../harness-session-resume/experiments/report.md)) proved that warm parking is
the ONLY tier that meets the invariant: the pending call survives a hard kill on disk in both
harnesses, but neither harness will answer it on load; both settle it as errored and re-issue.
So harness session resume gives faithful continuation, not exact resumption, and this folder's
work (extending the warm park to the remaining gates) cannot be replaced by it.

For the two Pi gates the mechanism is decided and proven live: Option C, routing the approval
over the ACP permission plane the `pi-acp` bridge already has (`ctx.ui.confirm` at the gate, a
JSON envelope carrying the real tool identity, the runner's slice-2 park machinery holding the
request). The [spike-option-c report](spike-option-c/report.md) has the evidence, including a
three-minute held gate that resumed the original call with its original arguments.

## Who should read this

- Anyone extending keep-alive past slice 2.
- Anyone working on the backend warm-session move or harness session resume; this design must
  land on top of (or inside) that work, and the two are tiers of the same invariant.
- Anyone touching the Pi tool relay (`services/runner/src/tools/relay.ts`,
  `services/runner/src/tools/dispatch.ts`) or the internal tool MCP server
  (`services/runner/src/tools/tool-mcp-http.ts`).

## Read first

- [architecture-notes.md, Decision 6](../../architecture-notes.md) ("the approval win, for
  Claude today and Pi later"). This document is the deep dive behind that decision's future
  path paragraph.
- [how-approvals-work.md](../../../approval-boundary/how-approvals-work.md), the full gate
  model, the three gates, and the two planes (messages and interactions).
- [The experiments](../../../harness-session-resume/experiments/): the protocol and report for
  the kill-and-resume runs that settled what each tier can guarantee.

## Files

- [design.md](design.md): the full design. The invariant, the measured tier ranking, each of
  the three gates (how it pauses today, why it is not parkable, the options, the choice), the
  per-gate cold paths, how the result composes with keep-alive, session resume, and the
  interactions plane, ownership and ordering, and risks.
- [spike-option-c/](spike-option-c/): the live spike that proved Option C. Protocol, report,
  the spike extension, the ACP client, and the raw wire transcripts.
