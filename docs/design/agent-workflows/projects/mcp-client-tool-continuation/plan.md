# Plan

Revised 2026-07-11 after a Codex xhigh review. The verdict: do not build the warm hold-open
path yet. The plan measured transport feasibility but not user-visible value; it proposed a
registry, a new pool state, a new resume verb, long-lived sockets, and extensive race
handling without establishing how often cold replay actually harms users. This revision
adopts that rescope. The owner LGTM'd the fuller plan before the review; see
[status.md](status.md) and [open-questions.md](open-questions.md) for the deferral
provenance and the review question it raises.

## Decision summary

- **Ship now: WP0 (expanded) and WP1.** Measure both the transport ceiling and the cold
  path's real user cost, and harden the loopback endpoint. Neither changes client-tool
  behavior.
- **Defer: WP2 through WP5** (the continuation kernel, the hold-open path, the failure
  envelope, the canary). They unlock only if two measurements pass; the gates are below.
- Keep [interface.md](interface.md) as a revised design note for the deferred path, not an
  implementation contract.
- Keep the cold path as the one continuation mechanism until the gates pass. It is working
  code with bounded failure behavior; its weakness (name-and-arguments matching instead of
  exact identity) must be shown to be materially visible before a second mechanism exists.

## Unlock gates for the warm path

Both must pass; either failing keeps the deferral:

1. **Transport gate.** WP0 shows Claude keeps the original MCP request usable beyond the
   60-second idle TTL, with a measured ceiling and a safety margin. If the request does not
   survive 60 seconds, cut the warm path permanently, not just defer it.
2. **Value gate.** The cold-path baseline shows material user harm. Proposed thresholds,
   for the owner to confirm or adjust: the first cold reissue fails to match the stored
   browser result in more than 5 percent of client-tool turns, or argument drift causes a
   repeated browser interaction in more than 2 percent, or the cold continuation adds
   user-visible latency (seconds at p50, not milliseconds) or model cost that support or
   users actually report. If cold drift is rare, defer even when the timeout gate passes.

A third condition applies at build time, not as a measurement: the warm mode may only be
enabled in owner-routed deployments (a single runner replica, verified session affinity
covering the browser resume, or an owner-routing token that actually reaches the owner).
Without owner routing, warm continuation stays unsupported and the runner chooses cold
immediately; the concurrency risk of a wrong-replica cold start racing a live owner is
worse than a lower hit rate. See "Wrong-replica commit point" below.

## WP0: measure the transport ceiling and the cold-path baseline

### Purpose

The runner controls the server side of the internal MCP request; Claude controls the
client-side timeout. And no design can justify a second continuation mechanism until the
first one's failure rate is measured. WP0 now answers both.

### Work: transport ceiling (unchanged)

- Add a repeatable local Claude experiment that exposes one client tool and intentionally
  delays its result.
- Record the pinned Claude harness, ACP adapter, MCP SDK, Node, and runner versions.
- Test a hold longer than the 60-second idle TTL first; if that succeeds, test beyond the
  300-second approval TTL.
- Record whether Claude keeps the same MCP request id and ACP tool-call id, closes the
  connection, retries, or settles the call with an error.
- Measure one quiet pending socket's file-descriptor and memory delta separately from the
  already measured live Claude process tree.

### Work: cold-path baseline (new)

From production traces where available, otherwise from a realistic QA batch of client-tool
turns:

- The percentage of browser results matched successfully on the first cold reissue.
- The percentage where Claude changes arguments and causes another browser interaction.
- The added model calls, latency, and token cost of the cold continuation turn.
- The percentage of resumptions that reach a different runner replica than the one that
  parked.
- Typical and percentile user wait times between the browser result and the continued
  answer.

### Exit

A checked-in experiment protocol and report covering both measurements, scored against the
unlock gates. No production behavior change.

## WP1: harden the existing internal MCP endpoint

### Purpose

The endpoint already dispatches Agenta tools and currently relies only on loopback
reachability (`mcp-bridge.ts` advertises no headers). This is justified independently of
the warm path and lands regardless of the gate outcomes.

### Work

- Generate a random bearer token per session environment; each environment owns a distinct
  server and token.
- Advertise the token in the MCP server's standard `authorization` header.
- Authenticate from the request headers before reading or parsing the body, and reject
  missing or wrong tokens before any dispatch.
- Make the token comparison timing-safe.
- Test token rotation after environment replacement.
- Keep the existing one-megabyte request-body cap. Treat the result-size cap as a separate
  concern from authentication, and state which stage it bounds (the incoming `/run` output,
  the serialization, or the MCP response body) when implementing it.
- Reject a JSON-RPC batch containing a client tool before executing any item in that batch.
  Batch semantics are protocol behavior, so the rejection lives in the server's message
  handling in `tool-mcp-http.ts`; if PR #5234 later extracts a minimal shared MCP
  dispatcher while building its stdio shim, the rejection moves with it. (The earlier
  ordering, where PR #5234's handler extraction landed before WP1, is gone: that
  extraction was cut from #5234's v1.)
- Keep non-client batches unchanged unless a test finds a protocol violation.
- Add focused HTTP integration tests for initialize, list, normal call, unauthorized call,
  malformed JSON, oversized body, client-tool batch rejection, and close.
- Run one live local Claude test to confirm the ACP adapter forwards MCP headers.

### Exit gate

An unauthenticated sibling process cannot list or call tools. Valid local Claude behavior
remains unchanged. The MCP server integration suite owns its real socket lifecycle.

### Rollback

Revert this package independently. It does not depend on any warm-path decision.

## Deferred: the warm hold-open path (old WP2 through WP5)

The full work packages from the earlier revision stay in this file's history and are not
scheduled. If the unlock gates pass, the build follows the revised shape below, which also
folds in the review's structural findings:

- **No standalone continuation registry.** The session pool already owns capacity, TTL,
  atomic checkout, and teardown, and the first release allows one pending client tool per
  environment. Build instead: a neutral `ParkedClientTool` record beside `ParkedApproval`
  in the sandbox-agent session model; an `awaiting_client_tool` state and a dedicated
  checkout in `session-pool.ts`; an exact current-turn result extractor beside the existing
  responder extractors; and `McpHttpResultDelivery` under `tools/` as transport code. A
  durable registry appears only at a future gateway boundary, when a second owner exists to
  constrain the abstraction.
- **The slimmed delivery port** in [interface.md](interface.md): `deliver` plus `dispose`,
  no `cancel`, no `onClosed`. Correctness rests on lease expiry and environment teardown,
  never on a transport close signal.
- **Warm registration requires proven correlation.** Register only when the correlation
  index returned a real harness tool-call id; otherwise destroy the MCP response and use
  cold replay. The best-effort fallback id is acceptable for cold replay only.
- **Register before the interaction is emitted.** The current code correlates, marks the
  paused call, emits the browser interaction, and creates the durable interaction inside
  `buildClientToolRelay` before the HTTP layer learns anything. Refactor to a
  prepare/commit sequence: prepare the pending call and return the correlated identity
  without emitting; register the delivery and park ownership; then emit the interaction
  and pause; on registration failure, commit the cold-pause form explicitly.
- **Owner-routed deployments only**, per the third condition above.

### Wrong-replica commit point

The fallback design must fix one commit point precisely:

- **Before delivery is accepted:** the inbound browser result stays readable so cold replay
  can use it. A resume that reaches a non-owner replica goes cold with the preserved
  result.
- **After delivery is accepted:** never start a cold continuation because the original
  prompt later fails. The MCP result may already have been consumed by the harness, and a
  second continuation would double the side effects.

A resume on replica B while replica A owns the live handle cannot cancel or invalidate A;
restricting warm mode to owner-routed deployments is what prevents the overlap, not the
fallback logic.

## Deployment and compatibility notes

- WP0 and WP1 have no dependency on PR #5197 or PR #5234 and can land now.
- If the warm path is later authorized, it starts only after PR #5197 merges (it edits the
  same environment, park, teardown, and continuity code); rebase and re-check
  `sandbox_agent.ts`, `server.ts`, `session-pool.ts`, and `shouldPark` first.
- PR #5234 no longer extracts a shared MCP handler in its v1, so nothing here waits on it.
  Its project narrows the Daytona refusal for executable tools; client tools on Daytona
  keep the up-front refusal until the separate bridge workspace exists (see
  [../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md)).
- No new public wire field is required. The existing browser `tool_result.toolCallId` is
  the exact live key if the warm path is ever built.
