# Status

> Superseded: the permission/approval model described here was redesigned in [projects/approval-boundary/](../../approval-boundary/) (2026-07). Kept as a dated record.

**State: design under review. No platform code changed.** Live-verified on
`bighetzner.agenta.dev`.

The direction is **streaming everywhere** the full turn matters, with **batch left unchanged**. The
external client already streams (the lab kit). The platform's own internal invoke paths still send
`Accept: application/json` and get the same partial output, so the platform-side change is to make the
result-consuming invoke paths stream and drain the event stream. A separate, confirmed runner bug (the
approval boundary) stops an auto-approved run at the tool gate; it is documented in
`approval-boundary.md`.

## What is decided / established

- **Batch is unchanged.** `_agent_batch` returns one final assistant message
  (`services/oss/src/agent/app.py:303-321`). We do not coalesce the full turn into it and do not touch
  `flags.history`. Decided from the user's review.
- **Streaming is the full-turn path** and is a first-class negotiated format
  (`Accept: application/x-ndjson | text/event-stream | application/jsonl`, or `flags.stream:true`);
  the batch↔stream choice is `flags.stream`, negotiated from `Accept`
  (`sdks/python/agenta/sdk/decorators/routing.py:551-554`). Confirmed live.
- **Client side shipped.** The lab kit `agent-creation-lab/kit/scripts/test-agent.sh` streams (prints
  OUTPUT + ordered TOOLS + APPROVAL) and `BUILD-AGENT.md` reads the TOOLS line as the reliable signal;
  `check-tools.sh` marked optional. Not in this PR.
- **Platform invoke paths mapped** (research §5). All platform invoke goes through
  `WorkflowsService.invoke_workflow` (batch, `Accept: application/json`, service.py:556) or
  `invoke_workflow_detached` (single-frame ndjson, service.py:602-643). Result-consuming batch sites:
  workflow/agent-as-tool (`api/oss/src/apis/fastapi/tools/router.py:1306`), evaluations runtime
  (`api/oss/src/core/evaluations/runtime/adapters.py:104, 508`). Triggers/schedules and session-respond
  run detached in production. No platform path drains the full stream synchronously.
- **Platform-side proposal:** a draining `invoke_workflow_streaming` variant on `WorkflowsService`
  (Accept ndjson + drain all frames to the terminal result), converting workflow/agent-as-tool first,
  evaluations second. Detail in `plan.md`.
- **Approval boundary is a bug** (`approval-boundary.md`). `HITLResponder.onPermission` parks on any
  session id before consulting the `auto` policy (`services/agent/src/responder.ts:257`), and the SDK
  mints a `sessionId` for every invoke, so `auto` never auto-approves in-band; the turn ends at the gate
  with `stopReason: "paused"`. Introduced in `b109cc51ef` (2026-06-25). The playground hides it by
  auto-resending on the park. Recommended fix at `responder.ts:254-259`.

## Live evidence

- Batch trace `901d24c25f3491fe3badbbb521ea5a55` — response was mid-sentence
  `"...posting the digest now."`; spans show all 4 tools ran.
- Streaming trace `894862fe8af0c3aae9e63e2637babab9` — 48 events, all 4 `tool_call`s incl.
  `SEND_MESSAGE`, 3 `tool_result`s, the `user_approval` interaction with the full digest payload,
  `done`; the run stops at the gate (approval-boundary bug).
- Re-run via the new streaming `test-agent.sh`: trace `1af7bda57e9ae50d388b6c567130ce77` — the
  invoke response itself listed `github__LIST_COMMITS -> github__LIST_REPOSITORY_ISSUES ->
  slack__LIST_ALL_CHANNELS -> slack__SEND_MESSAGE (4 calls, 3 results)` plus the approval line, with
  no separate span query.

## Open questions

1. **First platform site to convert.** Lean workflow/agent-as-tool (`tools/router.py:1306`) — it is the
   result-consuming batch path that visibly reproduces the partial output. Evaluations second. Do
   triggers/sessions need inline drain (with intermediate persistence) or is detached fire-and-forget
   enough? Lean: leave detached unless live persistence is wanted.
2. **`invoke_workflow_streaming` shape.** Confirm the terminal `{"kind":"result"}` record populates
   `messages`/`events`/`stop_reason` the same way `result_from_wire` populates the one-shot `/run`
   result (`wire.py:149-183`), so the drained platform result is behavior-preserving for the adapters.
3. **Approval-boundary fix scope.** The one-liner at `responder.ts:257` makes `auto` stream through, but
   the playground relies on the park to show its approval prompt. Add an `ask` disposition (or plumb the
   per-tool `permission` from `relay.ts`, `TODO(S5)` at relay.ts:108) so it parks only on a genuine
   human decision. Sequence the one-liner and the `ask` disposition.

## Next steps

- Get this design reviewed (see the PR comment for exactly what feedback is needed).
- On approval: implement the draining `invoke_workflow_streaming` variant and convert workflow/
  agent-as-tool + evaluations; fix the approval boundary at `responder.ts` with the `ask`-disposition
  follow-up; capture a live pass as a replay test; run `keep-docs-in-sync` for the invoke docs +
  interface inventory.
</content>
