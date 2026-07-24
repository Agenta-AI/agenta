# Sessions FE ↔ Backend — points to align on

Tags: **🔴 BLOCKER** (FE can't proceed) · **🟡 CONFIRM** (FE can build once the contract is agreed).
Ordered by how much FE work each unblocks.

## Framing

PR #4916 shipped the durable **read** plane (transcripts) live — FE step 1 (server-backed
history) is wired and working. The **control** planes (interactions/HITL, streams/live-run)
are scaffolded in the API but **not wired to the runner**, so the FE-side API surface is
built and parked. The points below are what it takes to light those up.

## A. Transcripts (read plane) — LIVE 🟡 confirm contract

1. **Payload stability** — is `payload` guaranteed 1:1 with the ACP `AgentEvent` union
   (`services/agent/src/protocol.ts`)? Any event types the FE should expect that aren't in
   that union?
2. **Ordering & pagination** — is `queryTranscripts` always ordered ascending by uuid7
   `id`? `SessionTranscriptQueryRequest` only has `session_id` — is there a result cap /
   cursor for long sessions, or does it return the whole log?
3. **`sender` values** — confirm the exact set (`user` / `runner` / `system`?). FE groups
   messages by this.
4. **User-turn persistence** — is the user's *own* message persisted as a transcript event
   (`sender=user`), and with what payload shape (plain text? multimodal/files)? Determines
   how we replay user turns.
5. **Deltas vs coalesced** — does the transcript store `message_start/delta/end` rows or
   only the coalesced `message`? (FE handles both; just want to know.)
6. **64KB truncation** — payloads over the cap become `{"_truncated": true}`. How should
   the FE render a truncated event?

## B. State / resume — runner-owned 🟡 confirm division of labor

7. Confirm FE treats `/sessions/states` as **read-only** (only `getState` for sandbox
   awareness) and must **never** `setState(data)` (it'd clobber the runner's
   `SessionRecord`). Correct?
8. Is sandbox **resume fully automatic** by `session_id` once a run goes through the runner
   — i.e. the FE does nothing? Or is there anything FE-side (e.g. `setStateSandboxId`)?
9. Is there a state value worth surfacing in the UI (e.g. "sandbox alive")?

## C. Interactions / HITL — INCOMPLETE 🔴 blockers

10. **🔴 Rows aren't created** — the runner emits `interaction_request` to the transcript
    but does **not** create a `SessionInteraction` row, so `queryInteractions` is empty for
    real runs. Who creates the row, and when (should be on park)?
11. **🔴 Respond doesn't transition status** — `respondInteraction` enqueues a re-invoke but
    leaves `status.code = pending` forever (only the admin `transition` endpoint flips it).
    Should respond transition pending→resolved/denied?
12. **ID correlation** — transcript `interaction_request.id` appears to map to
    `SessionInteraction.token`, not `.id` (unique on `project+session+token`). Confirm the
    intended FE flow: query by token → respond by row id? Or will the transcript event carry
    the interaction row id directly?
13. **Answer shape** — `respondInteraction.answer` is an unvalidated `Dict`. What exact
    shape for approve vs deny (`{approved: true/false}`?), and is there an **"always allow"**
    option — where is it stored/honored on resume?
14. **Resume-after-respond** — responding does **not** continue the run inline; does the FE
    then call `invokeStream`? Confirm the intended sequence (and whether it only applies to
    the streams path).
15. **Scope** — confirm v1 = `user_approval` only; FE keeps `user_input`/`tool_call` gated
    off.

## D. Streams / live run — STUB 🔴 biggest blocker

16. **🔴 invoke is a stub** — `SessionStreamsService.invoke`/`_start_run`
    (`api/oss/src/core/sessions/streams/service.py`) only acquires Redis locks + writes a
    `SessionStream`/`session_runners` row; it **does not invoke the runner** and streams
    nothing.
17. **🔴 No stream-return path** — there's **no SSE/attach endpoint** delivering v6 chunks.
    The "watch live run" path is unspecified + NOT STARTED
    (`docs/designs/sessions/streams/tasks.md`). **What's the planned transport** — a
    `GET /sessions/streams/attach` returning `text/event-stream` v6 chunks? WebSocket? The
    FE `useChat` transport needs a `request → streamed-response`, so we need the endpoint +
    content-type.
18. **Replace vs complement** — the FE currently streams fine from the **runner** service
    (`/api/agent/chat`). Does the streams model **replace** that, or is it
    **invoke = coordination** layered on top of the existing runner stream? This decides
    whether step 4 is a transport rewire or just adding force/attach/detach/liveness around
    the current path.
19. **Mode semantics** — when wired, what should the FE do per
    `SessionInvokeResponseModel.mode` (`send`/`steer`/`cancel`/`attach`/`detach`) and for
    `force`/`detached`?
20. **Timeline** — the brief frames streams as the multi-replica-correct path; what's the
    rough sequencing for 16–18?

## E. Cross-device session discovery 🟡

21. FE history (the picker) is localStorage-only, so a session this browser never ran won't
    appear. Transcripts is per-session (no list). Is there / will there be a
    **sessions-list endpoint** (by project/app), or should FE keep using the observability
    `ag.session.id`-off-traces aggregation? Align on the canonical "list sessions" source.

## F. Mounts (step 5) 🟡

22. Is `client.mounts.*` (agent working-dir file CRUD) actually live/wired, and what's the
    priority? (FE panel is optional/last.)

## G. Process / verification 🟡

23. What's the canonical way to get a **populated local env** — which compose profile +
    entrypoints (e.g. `worker_transcripts`) must be running for `queryTranscripts` to return
    rows? Several endpoints depend on a runner/worker rebuild.
24. The design docs are labelled "draft / not implemented." Can they be marked with **what's
    actually live** so the FE has a contract source of truth?

## What the FE already has ready

The full `@agenta/entities/session` surface — `querySessionTranscripts` (in use), plus
parked `getSessionState`, `queryInteractions` / `fetchInteraction` / `respondInteraction`,
and `queryStreams` / `getStreamLiveness` / `invokeSessionStream` — all matching the
generated client, ready to wire the day each plane lands.
