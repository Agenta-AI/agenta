# Telegram adapter — code-quality review

Scope: the diff `channels/fix-approval-card-on-park...channels/telegram`. Read-only
review; no code changed. Reference for "does the new code fit the architecture" is the
Slack adapter (`adapters/slack/`). Constraint respected: I do not propose changing JP's
channels architecture (adapter interface, outbox/inbox worker design, policy/thread
model); I flag whether the *new* code fits it.

Overall the adapter is a clean, faithful mirror of the Slack adapter: same `_call` /
`_ApiError` shape, same locator/verify/parse split, same capability-driven rendering, and
the string/int `bot_id` discipline is correct and well-commented. The findings below are
mostly edge cases and one real routing bug for forum topics.

Legend: **CONFIRMED** = traced through the code; **PLAUSIBLE** = reasoned but not fully
traced to a live failure.

---

## HIGH

### H1. Forum-topic messages misroute to the wrong topic / share one session — CONFIRMED
- `adapters/telegram/capabilities.py:69` (`thread: ["chat_id"]`), `mapping.py:35-37`
  (`classify_space_kind` returns `TOPIC`), `mapping.py:46-49` (`build_locator` adds
  `message_thread_id`), consumed by `tasks/asyncio/channels/outbox.py:339-343` (posts to
  `thread.data.external_locator`).
- Claim: the adapter advertises `spaces.topic = True` and actively classifies forum
  messages as `TOPIC`, but the thread identity key is `chat_id` only, so every forum topic
  in one supergroup collapses into a single thread/session.
- Failure: in a forum supergroup with topics A and B, the first message (topic A) creates
  a thread whose stored `external_locator` carries `message_thread_id: A`. A later message
  in topic B resolves to that *same* thread (same `chat_id` key), so (a) B's conversation
  continues A's session/history, and (b) the reply is posted with A's `message_thread_id`
  and appears in **topic A, not B** — a visible cross-topic answer leak. This fires the
  first time anyone uses the bot in a multi-topic forum.
- The capabilities comment ("Forum-topic separation … is a later refinement") acknowledges
  the deferral, but the code still classifies `TOPIC` and advertises `topic: True`, which
  sets up the misroute rather than degrading safely. Cheapest guard within the existing
  model: either add `message_thread_id` to the `thread` key, or stop classifying/advertising
  `TOPIC` until the key supports it. Severity high because it silently sends one chat's
  answer into another topic.

---

## MEDIUM

### M1. `activate_connection` failure only logs — connection looks live but the webhook is never registered — CONFIRMED
- `core/channels/service.py:210-226` (try/except around `activate_connection`, `log.warning`
  then continue); adapter side `adapters/telegram/adapter.py:150-187`.
- Claim: if `setWebhook` fails (bad `api_url`, Telegram 5xx, network), `create_connection`
  returns the stored connection with `is_verified = True` and no error, but Telegram was
  never pointed at our ingress, so the bot will never deliver an update.
- Failure: the user sees a successful connection that is permanently dead. There is no
  `inactive`/`activation_failed` flag on the row, no retry, and nothing surfaced to the
  caller — only a server-side warning line. The comment says "re-activation is a follow-up"
  but no re-activation path exists in this diff. At minimum the row should carry a state the
  UI/ops can see, or the create should report a partial-success signal.
- Missing test: the whole service wiring added here — mint `webhook_secret`, capture
  `activation_credentials` before nulling, call `activate_connection` post-store, swallow its
  failure — is untested. The adapter's `activate_connection` is unit-tested in isolation
  (`test_telegram_adapter.py:422`), but the service path (including the swallow-and-continue
  branch) has no coverage.

### M2. `answer_callback_query` is dead code with a false docstring — CONFIRMED
- `adapters/telegram/adapter.py:362-376`.
- Claim: the docstring says "the ingress calls it eagerly on an ACTION," but a repo-wide
  grep finds no caller anywhere (`api/oss/src`, `api/entrypoints`). The ingress
  (`apis/fastapi/channels/ingress.py`) never calls it.
- Failure: the method never runs, so a user who taps an inline-keyboard (approval) button
  keeps seeing the client's loading spinner until Telegram times it out. Minor UX, but the
  docstring is factually wrong and will mislead the next reader into thinking the spinner is
  handled. Either wire it into the ACTION path or delete it and drop the "ingress calls it"
  claim.

### M3. Idempotency guard covers only the sequential double-publish, not the concurrent one — PLAUSIBLE
- `tasks/asyncio/channels/outbox.py:296-305`; adapter `post_message` ignores
  `idempotency_key` (`adapter.py:275-315`).
- The guard (`event.state is SENT and processed.content == content → return`) correctly
  stops the *sequential* re-fire of `turn_ended` (I traced that `_get_or_create_item`
  re-reads the row as `SENT`, and the SENT row stores `processed={"content": content}` in the
  same shape the guard compares — CONFIRMED it works sequentially).
- But if the two publishers (`complete_turn` and the records worker post-commit) run close
  enough that both read the row as `CREATED` before either writes `SENT`, both call
  `post_message`. Telegram's `post_message` does not honor `idempotency_key` (no wire-level
  dedupe — same as Slack), so on a no-edit channel this posts the answer **twice** to the
  user. Whether this is reachable depends on how the outbox worker serializes per row; worth
  confirming that two `on_turn_ended` invocations for one turn cannot interleave.
- Missing test: the guard's *stated primary purpose* — preventing a duplicate fresh message
  on a `controls.update = false` channel (Telegram) — has no test. The existing
  `test_channels_outbox_worker.py:555` redeliver test uses the `fake` edit-capable adapter,
  so it exercises the edit branch, not the no-edit duplicate-prevention the comment is about.

### M4. Message splitting cuts already-escaped HTML at a fixed offset — can break an entity — CONFIRMED (logic)
- `adapter.py:293-307` calls `split_for_max_chars(text, ...)` where `text` is already
  `to_html(...)`-escaped (`mapping.py:160,166`); split is a raw slice `remaining[:max_chars]`
  (`mapping.py:114-125`).
- Claim: splitting escaped HTML at a fixed character boundary can cut in the middle of an
  entity (e.g. `&amp;` → `…&am` + `p;…`). Each chunk is sent with `parse_mode=HTML`, so a
  chunk with a truncated entity is invalid HTML and Telegram rejects it, raising
  `_TelegramApiError` and failing the send.
- Failure: an answer longer than 4096 chars whose 4096-boundary lands inside an escaped
  entity fails to deliver. Narrow today (escaping-only, boundary must hit an entity), but it
  becomes a live hazard the moment rich HTML tags are added. Note also Telegram's 4096 limit
  is UTF-16 based while the split counts code points, so a message of multi-byte characters
  near the limit can still exceed it.

---

## LOW

### L1. `is_addressed` mention matching uses code-point offsets against UTF-16 entity offsets — CONFIRMED (logic)
- `mapping.py:87-92`: `text[offset : offset + length]`.
- Telegram message-entity `offset`/`length` are counted in UTF-16 code units; Python slices
  by code points. A group message containing a non-BMP character (emoji, some CJK
  extensions) *before* the `@mention` misaligns the slice, so the mention is not recognized
  and the message is treated as not-addressed and dropped. Edge case, but real for groups
  with emoji. `bot_command` / `text_mention` / reply detection are unaffected.

### L2. `_is_indicator` is a fragile exact-string coupling to the render layer — CONFIRMED
- `adapter.py:432-439`, importing `INDICATOR_TEXT` from `render/render.py`.
- The typing-vs-message decision hinges on `texts == [INDICATOR_TEXT] and not has_button`.
  If the render layer ever emits the indicator with an extra part, a trailing space, or a
  different shape, the check silently fails and the bot posts "Thinking…" as a real chat
  message. It works today; it is just brittle and undocumented as a coupling contract.

### L3. `edit_message` is unreachable through the live outbox path — CONFIRMED
- `adapter.py:317-346`; outbox gate `outbox.py:315,318` (`can_edit =
  capabilities.rendering.controls.update`, which is `False` for Telegram).
- The method is fully implemented and unit-tested but the outbox never calls it for
  Telegram. Intentional (capabilities comment says it is kept "for a future in-place-edit
  use"), so this is a note, not a defect — just flag that it is currently dead in the
  delivered flow so a reader does not assume Telegram edits in place.

### L4. Auth allowlist entry is a `startswith` prefix over the token wildcard — LOW / informational
- `middlewares/auth.py:90-96`, matched by `request.url.path.startswith(_PUBLIC_ENDPOINTS)`
  (`auth.py:348`).
- `/channels/telegram/events/` (and its `/api`, `/preview` variants) makes *everything*
  under that prefix public. Correct and necessary here (the per-bot token segment follows,
  and the webhook secret is the real authorization), and it is consistent with the existing
  Slack/bridge entries, which are also matched by `startswith`. The only latent risk is that
  any future route mounted under this prefix would silently become unauthenticated — same
  caveat that already applies to every entry in the tuple. No over-exposure today.

### L5. `_parse_json` imports `json` inside the function body — LOW / nit
- `adapter.py:442-448` does `import json` in the function; the Slack adapter imports `json`
  at module top (`slack/adapter.py:1`). Trivial style divergence from the reference.

### L6. Indicator rename touches Slack too — LOW / informational (intended)
- `render/render.py:6` `INDICATOR_TEXT = "Thinking…"` (was "Working…") plus the Slack
  comment update. This is a shared-layer change that also changes Slack's displayed
  indicator, but commit `8f47f682d8` ("rename the turn indicator from Working to Thinking")
  shows it is a deliberate, separate change, not accidental scope creep. No test asserts the
  literal old string (remaining "Working…" references are comments/docstrings), so nothing
  breaks. Noted only so the cross-channel effect is on the record.

---

## Reuse / duplication check
- Rendering, chunking, and button-degrade logic are re-implemented in
  `telegram/mapping.py` rather than shared with Slack. This is appropriate: the output
  shapes differ (Telegram `inline_keyboard` + HTML vs Slack Block Kit + mrkdwn), and the
  per-channel `render_content`/`split_for_max_chars` split mirrors how Slack already does it.
  Not flagged as duplication.
- Secret minting (`webhook_secret`) reuses the exact pattern already used for the bridge
  `signing_secret` in `service.py` — good, consistent.
- `bot_id` string/int handling (`str(bot_id)` at discovery for the identity key/path,
  `int(...)` for payload comparisons) is correct and consistent across `verify_connection`,
  `verify_signature`, `is_bot_authored`, and `is_addressed` — CONFIRMED, no divergence.
- Vault round-trip verified: `webhook_secret` is added to `ChannelSecretSettingsDTO`
  (`secrets/dtos.py`), written via `_write_credential_secret`, hydrated back into
  `connection.data` via `_hydrate_connection` (`exclude_none=True`), and read by
  `_webhook_secret`/`_bot_token`. `_channel_secret_kind("telegram")` resolves via the new
  `ChannelSecretKind.TELEGRAM`. `bot_username` (non-identity) is stored flat by
  `_compose_connection_data`, so group @mention matching has the value it needs. All
  CONFIRMED sound.

## Findings by severity
- High: 1
- Medium: 4
- Low: 6
