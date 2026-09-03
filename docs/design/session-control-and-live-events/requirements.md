# Bugs and system requirements

> AGENT-GENERATED, low weight. Draft for discussion. Issue text is observation. Requirements are
> proposed interpretations until Mahmoud confirms them.

## Stop and recovery

Users report that Stop returns while backend work continues, hung turns keep `running=true`, and a
dead runner can leave the session unusable. These reports include
[#5160](https://github.com/Agenta-AI/agenta/issues/5160),
[#5982](https://github.com/Agenta-AI/agenta/issues/5982),
[#6418](https://github.com/Agenta-AI/agenta/issues/6418),
[#6100](https://github.com/Agenta-AI/agenta/issues/6100),
[#6449](https://github.com/Agenta-AI/agenta/issues/6449),
[#6099](https://github.com/Agenta-AI/agenta/issues/6099), and
[#6420](https://github.com/Agenta-AI/agenta/issues/6420).

The system must meet these requirements:

- Direct delivery carries normal Stop to the active runner.
- The five-second Stop latency is an alert threshold. Current evidence is below 300 milliseconds,
  and a release above one second needs a written reason.
- The client shows `stopping` until the API accepts Stop. It shows `stopped` only after the durable
  terminal event. A failed request restores `running` and reconnects or refreshes observation.
- Heartbeats report health and refresh ownership. They do not carry normal Stop delivery.
- A pending command for a beating session is redelivered with the same command ID and bounded
  attempts. A pending command whose runner is gone settles `lost`.
- Every accepted execution reaches one durable terminal outcome. A database compare-and-set on the
  execution row selects the winner.
- Runner and watchdog settlement use the same terminal operation.
- The watchdog settles an abandoned execution within 150 seconds. The client shows `recovering`
  during the 90-second stale period and the following sweep window.
- After settlement, the session is not running. It remains alive only while the runner has safely
  parked the sandbox.
- Normal Stop preserves the workspace and native harness session. Unsafe cleanup destroys or
  isolates the sandbox instead of claiming warm resume.
- A bounded watchdog sweep logs a timed-out pass and lets later passes continue.
- Any terminal failure leaves committed history readable and permits another message.

## Concurrent input and late output

Users report that a second message or Steer can kill both turns and block the session. These reports
include [#6417](https://github.com/Agenta-AI/agenta/issues/6417),
[#6020](https://github.com/Agenta-AI/agenta/issues/6020),
[#5790](https://github.com/Agenta-AI/agenta/issues/5790),
[#5539](https://github.com/Agenta-AI/agenta/issues/5539), and
[#5538](https://github.com/Agenta-AI/agenta/issues/5538).

The system must meet these requirements:

- One session has at most one active execution.
- The existing invoke operation accepts an `on_busy` policy and an `Idempotency-Key`.
- Version one defaults `on_busy` to `reject`. Queue and Steer remain unavailable until every
  enabled client displays pending input.
- The API compares the request body when an idempotency key repeats. An identical retry returns the
  first result, while a different request returns `409`.
- Public Stop can include `expected_execution_id`. First-party clients send it when known.
- The terminal execution row guards every later record for every terminal cause.
- Late output never enters canonical reads. Whether storage rejects or quarantines it remains open.
- Steer saves its input before Stop and preserves that input if Stop fails.

## Reattach and multiple readers

Today the sender receives invoke frames while secondary clients reload completed records after
watch notices. Refresh can also hide approvals or live work. Relevant reports include
[#5609](https://github.com/Agenta-AI/agenta/issues/5609),
[#5542](https://github.com/Agenta-AI/agenta/issues/5542),
[#6404](https://github.com/Agenta-AI/agenta/issues/6404), and
[#5611](https://github.com/Agenta-AI/agenta/issues/5611).

The system must meet these requirements:

- Every authorized client can follow one execution and receive temporary frames.
- A snapshot returns `{session, execution, pending, read}` and one durable sequence watermark.
- The transcript is paged so an old session cannot exhaust an API worker or browser.
- A reader replays durable events after the snapshot watermark, then follows new activity.
- Each SSE connection revalidates access or ends after a bounded lifetime.
- Runner frame ingress verifies the execution ID and current owner claim.
- Logs contain identifiers only. They never contain message content or tokens.
- Missed temporary frames are repaired by the next durable checkpoint.
- Desktop and mobile use one reducer and converge on the same state.

## Record durability and ordering

The records worker can lose accepted work during database failure, and it currently drops records
for an over-quota organization. Relevant reports include
[#5496](https://github.com/Agenta-AI/agenta/issues/5496) and
[#5594](https://github.com/Agenta-AI/agenta/issues/5594).

The system must meet these requirements:

- The records worker acknowledges ingest only after the Postgres transaction commits.
- One malformed record cannot discard unrelated valid records from the same batch.
- Session history is exempt from tracing quota and retention before records become permanent
  history. This is the first history task and a completion gate.
- Every durable producer event has a stable ID before its first send.
- Identical retries are idempotent and cannot change established order.
- New durable records are immutable. Progressive tool frames remain temporary until one complete
  checkpoint commits.
- A records-domain cursor allocates one sequence in the same analytics transaction as the record,
  unless Mahmoud chooses to move records to core.
- Every durable write after migration receives a sequence, including old endpoint writes.
- A write path that cannot allocate a sequence stays off behind the history flag.
- A persistence gap marks `history_complete=false`.
- The system never reports completion when durable settlement is unknown.

## Approvals and pauses

Today approval cards can remain actionable after Stop, and an accepted answer can disappear when
continuation delivery fails. Relevant reports include
[#6315](https://github.com/Agenta-AI/agenta/issues/6315),
[#6316](https://github.com/Agenta-AI/agenta/issues/6316),
[#6106](https://github.com/Agenta-AI/agenta/issues/6106), and
[#5592](https://github.com/Agenta-AI/agenta/issues/5592).

The system must meet these requirements:

- An interaction has one visible state: pending, resolved, denied, or cancelled.
- Stop cancels pending interactions for the target execution in the settlement transaction.
- A late answer cannot resume a cancelled or replaced execution.
- One transaction accepts an answer and creates its continuation execution and private command.
- A delivery failure cannot erase an accepted answer.
- Side-effecting tools do not run twice after pause and resume.
- One visible conversation turn remains traceable across approval continuations.

Claude Code's built-in shell may bypass the general `ask` permission. A dedicated Linear security
issue must own that defect and its reproduction. The decision list did not provide the issue URL,
so this document cannot link the exact issue yet.

## Session list and identity

Today a session can appear in the list without its accepted message, and browser-local identity can
diverge across clients. Relevant reports include
[#6419](https://github.com/Agenta-AI/agenta/issues/6419),
[#6463](https://github.com/Agenta-AI/agenta/issues/6463), and
[#5969](https://github.com/Agenta-AI/agenta/issues/5969).

The system must meet these requirements:

- A message accepted by the API is never lost when execution fails to start.
- A visible session has an explicit origin and owner type.
- Session list updates converge without a full reload.
- Rename and archive operations report success or failure.
- Session identity does not depend on the browser that created it.

## Requirement status

The seven increments in [`plan.md`](plan.md) assign implementation order. The remaining choices in
[`open-questions.md`](open-questions.md) block only the packages named there.
