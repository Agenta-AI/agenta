# Status

Last updated: 2026-07-11 (late)

## Current phase

Design review. No implementation code has been changed.

Draft design PR: [#5201](https://github.com/Agenta-AI/agenta/pull/5201), labelled
`needs-review`.

**Headline for the owner:** the warm hold-open path (old WP2 through WP5) is now DEFERRED
behind two measurement gates, on the recommendation of a Codex xhigh review folded in while
the owner slept. He had LGTM'd the fuller plan; this is a deliberate conservative rescope
under his standing simplify-aggressively instruction, and it is reversible. It is the top
item in [open-questions.md](open-questions.md).

## Completed

- Read the Codex onboarding, plan-feature, interface-design, GitButler, documentation, and PR
  writing guidance.
- Reviewed the current internal MCP server, client-tool relay, responder, session pool, keepalive
  dispatch, and MCP delivery boundary.
- Confirmed PR #5185 is merged and Pi approval parking is a separate completed path.
- Confirmed PR #5153 remains the draft home of the original hold-open recommendation.
- Refreshed PR #5197 at head `343d7146935a8eb3ed41a203cd9a3db6ee954eef` and incorporated its
  continuity invalidation, sandbox lifecycle, native session load, and ownership work.
- Classified existing risks separately from risks introduced by holding sockets open.
- Defined a gateway-neutral pending-operation and delivery-port contract.
- 2026-07-11: folded in the cross-consistency review round (transport-specific limits of the
  old port methods, the open transport union, the future in-sandbox stdio mapping and its
  three missing prerequisites, the WP1 bearer placement, the WP5 Daytona wording).
- 2026-07-11 (late): folded in the Codex xhigh review of this workspace. Changes:
  - **Rescoped v1 to measure and harden.** WP0 expanded with cold-path baseline metrics
    (first-reissue match rate, argument-drift rate, added model calls/latency/token cost,
    wrong-replica resumption rate, user wait percentiles). WP1 gained the review's
    hardening details (auth from headers before body parsing, timing-safe comparison,
    per-environment token, rotation test, result-size cap separated from auth). WP2
    through WP5 are deferred behind explicit unlock gates stated in [plan.md](plan.md).
  - **Slimmed the delivery port** in [interface.md](interface.md): `deliver` returning
    `accepted | unavailable(reason)` plus `dispose(reason)`; `cancel` and `onClosed` cut
    (they modeled an HTTP response handle); transport liveness is an optional adapter-owned
    closed signal; correctness rests on lease expiry and environment teardown.
  - **Replaced the standalone registry with pool-owned placement**: `ParkedClientTool`
    beside `ParkedApproval`, `awaiting_client_tool` plus checkout in `session-pool.ts`,
    exact extraction beside the responder extractors, `McpHttpResultDelivery` under
    `tools/`; a durable registry only at a future gateway boundary.
  - **Renamed `harnessToolCallId` to `toolCallId`** with its provenance documented as an
    invariant: warm registration requires a proven harness-correlated id; the best-effort
    fallback id is cold-only.
  - **Fixed the wrong-replica posture**: any future warm mode is restricted to owner-routed
    deployments, and the delivery commit point is defined (before `accepted`: preserve the
    inbound result for cold; after: never start a cold continuation).
  - **Dropped the dependency on PR #5234's handler extraction** (cut from that project's
    v1); WP1's batch rejection lands in `tool-mcp-http.ts` and moves only if a shared
    dispatcher is extracted later.

## Decisions proposed

- Defer the warm path behind the transport gate and the value gate; ship WP0 (expanded) and
  WP1 now.
- Require the measured client timeout to exceed 60 seconds, or cut (not defer) the warm
  path.
- Add loopback authentication before any hold-open work, and land it regardless.
- Restrict any future warm mode to owner-routed deployments.
- Use exact ACP tool-call identity for live completion and retain name-and-arguments
  matching only for cold fallback.
- Treat PR #5197 as the improved cold and lifecycle layer, not as a pending-operation store.

## Dependencies

| Dependency | State | Effect |
| --- | --- | --- |
| Session keepalive pool and approval parking | Implemented on `big-agents` | Supplies live session parking and resume structure for the deferred warm path. |
| Pi approval parking, PR #5185 | Merged | No client-tool work required for Pi. |
| Session keepalive design, PR #5153 | Draft | Contains the original client-tool hold-open recommendation and experiments. |
| Session continuity, PR #5197 | Open, next to merge | Gates only the deferred warm path, not WP0 or WP1. |
| In-sandbox tool MCP, PR #5234 | Open, design review | No longer a code dependency; its v1 dropped the shared-handler extraction. |
| Real MCP gateway | Out of scope | The interface note preserves a future adapter boundary. |

## Next step after approval

Run WP0 (both measurements) and post the report scored against the unlock gates. WP1 can
proceed in parallel as independent hardening. The warm path starts only if both gates pass,
and then only after PR #5197 merges and the implementation branch is rebased.
