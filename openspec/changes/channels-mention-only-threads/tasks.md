# Tasks

## 1. Trigger gate

- [x] 1.1 Remove the active-thread admission from `_is_trigger` for spaces that are not PRIVATE.
- [x] 1.2 Pass `resolved_token` from `resolve` into `_is_trigger` and admit the message when it is set, so a typed answer to a pending choice needs no mention.
- [x] 1.3 Update the docstrings and comments that described the old rule (`resolve`'s gate, `_is_trigger`, `_channel_defaults`, `_agent_holding_thread`).

## 2. Context offset

- [x] 2.1 Make `fetch_latest_trigger` skip only triggers that provably never ran: REFUSED, and FAILED with the `never_sent` status code. Any other FAILED trigger still moves the offset.
- [x] 2.2 Record `never_sent` in the dispatcher when the invoke raises `WorkflowDetachedStartNeverSent`.
- [x] 2.3 Bound the range at the addressing event (`through_event_id`), and take the offset from the latest counted trigger before it, ordered by event.
- [x] 2.4 Give every addressed message its own turn: no "already carried" skip, no lock, no late-attach step, no carried-events record. Document the concurrent-arrival limit.
- [x] 2.4b Look up the sender's identity before claiming the trigger, so a failed lookup never drops a mention. Track the `!new` retry double-run separately (#7131).
- [x] 2.5 Mark an answer to a parked interaction consumed, and keep consumed events and clicks out of composed input.
- [x] 2.6 Update the DAO interface docstrings.

## 3. Tests

- [x] 3.1 Invert the test that pinned "a reply in a held thread opens a turn", and add the mentioned-reply variant.
- [x] 3.2 Make the follow-up addressed in the specialist-continuation test and in the "fails to match stays an ordinary message" test.
- [x] 3.3 Add: an unaddressed reply is stored and opens no turn.
- [x] 3.4 Add: the M1, five, M2, three, M3 context test, as a unit test and against Postgres.
- [x] 3.5 Add: a typed "Approve" or "2" with no mention resolves the pending choice.
- [x] 3.6 Add: an unaddressed message in a Slack group DM and in a Telegram group opens no turn after an earlier mention; a Telegram reply to the bot and a command still do; a Telegram private chat answers everything.
- [x] 3.7 Add: a FAILED or REFUSED turn's messages carry into the next turn, as a unit test and against Postgres, plus a DAO test for `fetch_latest_trigger`.
- [x] 3.8 Add: a message stored mid-compose, the queued M2 and M3 payloads, a lost response after delivery, a start never sent, a failure after a later turn began, and forwardfill after typed, clicked and stale answers.
- [x] 3.9 Add Codex's dispatch-order repros (concurrent mentions with a redelivery, an earlier mention dispatched late, a DM message dispatched after a later one, a mention delayed for hours), each asserting every mention runs exactly once, in unit tests and against Postgres.
- [x] 3.10 Run the channels unit suite and the channels integration tests.

## 4. Records

- [x] 4.1 Note in `docs/design/channels-research/v2/takeover-2026-09-08.md` that the F83/F94 "replies in a thread the bot already answered in" decision is superseded.
- [ ] 4.2 Live QA in Slack and Telegram (run separately after merge).
