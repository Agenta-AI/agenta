# WP5 tasks — Outbox worker

## Setup

- [x] Branch from the seed commit (C1, per `c1-merge-notes.md` — wave 2
      branches from `channels-c1`, not a wave-1 package). Confirmed
      `ChannelsService`, `ChannelOutboxEvent*` DTOs, `ChannelDeliveryState`
      import cleanly.
- [x] Add `tasks/asyncio/channels/outbox.py` worker skeleton and
      `core/channels/render/` module skeleton, then filled both with logic
      (skeleton-then-fill collapsed into one pass; no skeleton-only commit).

## Polling loop (interim, deleted at WP0)

- [x] Implemented `ChannelsOutboxWorker.poll_turn` as a single call boundary:
      it looks up the thread, reads the latest turn, and dispatches to
      `on_turn_started`/`on_turn_ended` by `end_time`. `on_turn_started` and
      `on_turn_ended` take no poll-specific arguments, so the WP0 swap only
      ever needs to replace `poll_turn`'s body.
- [x] `poll_turn`'s docstring names WP0 as the removal trigger, not a flag.

## Turn started

- [x] Checks `channel_threads` for the session via `ChannelsService.query_threads`
      (one indexed lookup); returns early if no thread — not a channel turn.
- [x] Creates the outbox row via `ChannelsDAO.record_outbox_event` directly
      (see note below on `enqueue_output`), `state=CREATED`, item 0.
- [x] Renders an indicator per the capability declaration and posts it.
- [x] Calls `ChannelsDAO.transition_outbox_event` to set `state=SENT` and store
      `data.external_locator` from the adapter's receipt.
- [x] Tested: `test_turn_started_produces_exactly_one_created_then_sent_row`
      (unit), `test_turn_started_writes_exactly_one_channel_outbox_row`
      (integration, written not run).

  **Deviation from the spec's literal method names, recorded per
  c1-merge-notes.md's rule ("write down what you assumed"):** the spec's
  "Interfaces" section names `ChannelsService.enqueue_output`/`.deliver` as
  the calls to make. Both are still `raise NotImplementedError` stubs in
  `core/channels/service.py` at C1 — that file is WP1's, not WP5's, per
  `workstreams/README.md`'s ownership table, so WP5 does not fill them in.
  This worker instead calls `channels_service.channels_dao.record_outbox_event`
  / `.fetch_outbox_event_by_key` / `.transition_outbox_event` /
  `.claim_outbox_events` directly — all four are real, implemented DAO
  methods reachable through the service today, and specs-wp5.md's own
  "Interfaces" section lists them as the DAO methods WP5 reaches "through the
  service." Flagged as an open item below, not silently worked around.

## Turn ended

- [x] Queries the turn's records by filtering `RecordsService.get_records`
      (session-scoped; no DAO method takes `turn_id` directly) by
      `record.turn_id == turn_id` in Python. See report for why.
- [x] Transforms each matching record (`record_type`, `attributes`) into
      `fold()`'s `{type, data}` shape before calling
      `fold(events, stop_reason=None)`; consumes exactly
      `{messages, stop_reason, pending_interaction}`.
- [x] Finds the existing outbox row via `fetch_outbox_event_by_key` using the
      derived `key` (never the row id) for every item, including item 0.
- [x] Renders the fold result per capability (buttons vs numbered text, split
      at `max_chars`, card from `pending_interaction`'s recorded tool call).
- [x] Edits the platform message using the stored `external_locator`;
      computes a fresh `idempotency_key` from `key` + the row's current
      `updated_at` before sending.
- [x] Calls `transition_outbox_event` to update `data.processed` and state,
      keeping the same row.
- [x] Tested: `test_turn_ended_edits_the_same_row_created_at_turn_started`
      (unit), `test_turn_ended_edits_the_same_row_across_a_real_transition`
      (integration, written not run).

## Degradation rendering

- [x] Buttons-supported path: renders a card part plus one `{"type":
      "button"}` part per option, up to `rendering.buttons.max` — one part per
      button, matching the shape the WP2 contract suite's `post_message`
      fixture counts (`item.get("type") == "button"` across the whole
      `content` list), not a grouped multi-option part.
- [x] Numbered-text fallback: buttons unsupported, or the option count
      exceeds `max`.
- [x] `max_chars` split: multiple items (0, 1, ...), each independently keyed
      via `compose_outbox_key(thread_id, turn_id, item_index)` and
      independently editable.
- [x] `controls.update: false` fallback: posts a new message instead of
      editing when a receipt already exists but the capability forbids
      updates.
- [x] Tested each path against a fake `ChannelCapabilities` toggling the
      relevant field (`test_channels_render.py`), plus one end-to-end split
      test through the worker (`test_long_answer_splits_into_multiple_independently_editable_rows`).

## Hard exclusions

- [x] Test: no thought/usage/internal-reasoning event ever appears in
      rendered output (`test_no_raw_thought_or_usage_event_ever_appears_in_rendered_output`)
      — enforced structurally too: `_extract_answer_text` only reads
      `fold()`'s own `messages` list, which already drops those event types.
- [x] Test: no raw ACP/record payload string appears verbatim
      (`test_no_raw_acp_payload_string_appears_verbatim`) — the render module
      only ever reads named fields (`tool`, `payload.toolCall.{arguments,input}`)
      off `pending_interaction`, never serialises the payload wholesale.

## Idempotency and redelivery

- [x] Test: redelivering the same turn-ended signal does not create a second
      row (`test_redelivery_of_turn_ended_does_not_double_post`, unit).
- [x] Test: idempotency key for the initial post differs from the key for the
      edit; a retry of either individual send re-derives its own unchanged
      key (`test_idempotency_key_differs_between_post_and_edit_but_is_stable_on_retry`).

## Wiring

- [x] `api/entrypoints/routers.py` diff block prepared, NOT applied — see
      final report for the verbatim text, held for the checkpoint's
      serialised merge together with WP4's.

## Open items (not closed by this worktree)

- [ ] `ChannelsService.enqueue_output`/`.deliver` remain `NotImplementedError`
      stubs. WP5 routed around them (DAO-direct, see "Turn started" above)
      rather than editing `core/channels/service.py`, which it does not own.
      Whoever picks up WP1's remaining surface should either implement them
      to match what this worker already does, or the checkpoint should adopt
      the DAO-direct call shape as the real contract and mark the two service
      methods dead.
- [ ] No DAO method returns records filtered by `turn_id`; WP5 filters
      `RecordsService.get_records(session_id)` in Python instead. A DAO-level
      `get_records_by_turn` would be more efficient at scale but requires
      editing `dbs/postgres/sessions/records/`, which WP5 does not own — left
      as a coordination note rather than an edit.
- [ ] `Connection.provider_key` is typed `ConnectionProviderKind` (only
      `{composio, agenta}`) in `core/gateway/connections/dtos.py`, but a
      channels connection's `provider_key` actually holds the channel key
      string (`"slack"`, `"fake"`) that `ChannelsService._resolve_channel`
      and the adapter registry key on — the column itself is a plain
      `String`. This is a pre-existing typing gap in a shared file neither
      WP1 nor WP5 owns; worked around in tests with `model_construct`, not
      fixed here.
- [ ] The taskiq entry point (`outbox_worker.py`) registers one task,
      `channels.outbox.poll`, taking `(project_id, session_id)`. Nothing
      currently schedules it repeatedly (no periodic-task primitive was
      found elsewhere in this codebase's `tasks/taskiq/` — the `triggers`
      domain's own sweep is invoked externally, not via a taskiq cron). Left
      for the checkpoint to wire a scheduler; out of WP5's file-ownership
      list (`tasks/taskiq/channels/outbox_worker.py` only defines the task).

## Definition of done

A completed turn appears in the target space (unit + integration-written
coverage), an approval renders as a card built from the recorded tool call
(never model-composed text — enforced by reading only `pending_interaction`,
never message text, on the paused path), and a redelivery does not
double-post (tested). Feeds C2 against polling; feeds C4's exit condition
once WP0 lands and the polling code is deleted (not disabled) — see report
for the exact assumption this worktree made about WP0's shape.
