# Bugs and system requirements

> AGENT-GENERATED, low weight. Draft for discussion. Issue text is observation. Requirements are
> proposed interpretations until Mahmoud confirms them.

## Stop and hung executions

Issues: [#5160](https://github.com/Agenta-AI/agenta/issues/5160),
[#5982](https://github.com/Agenta-AI/agenta/issues/5982),
[#6418](https://github.com/Agenta-AI/agenta/issues/6418),
[#6100](https://github.com/Agenta-AI/agenta/issues/6100),
[#6449](https://github.com/Agenta-AI/agenta/issues/6449),
[#6099](https://github.com/Agenta-AI/agenta/issues/6099),
[#6420](https://github.com/Agenta-AI/agenta/issues/6420),
[#6327](https://github.com/Agenta-AI/agenta/issues/6327),
[#5788](https://github.com/Agenta-AI/agenta/issues/5788),
[#6102](https://github.com/Agenta-AI/agenta/issues/6102),
[#6103](https://github.com/Agenta-AI/agenta/issues/6103),
[#6084](https://github.com/Agenta-AI/agenta/issues/6084),
[#5356](https://github.com/Agenta-AI/agenta/issues/5356),
[#5327](https://github.com/Agenta-AI/agenta/issues/5327),
[#6441](https://github.com/Agenta-AI/agenta/issues/6441),
[#6313](https://github.com/Agenta-AI/agenta/issues/6313).

Observed examples:

> “After clicking Stop, the UI reflects the stop action immediately, but backend processing
> continues for several minutes.” ([#5160](https://github.com/Agenta-AI/agenta/issues/5160))

> “The turn hangs forever. `runTurn` never resolves, the alive watchdog keeps heartbeating
> `running=true`.” ([#6418](https://github.com/Agenta-AI/agenta/issues/6418))

Draft requirements:

- Normal Stop reaches the active runner within a defined short deadline through direct delivery.
- Heartbeats report runner health and refresh ownership. They are not the normal Stop-delivery path.
- After Stop settles, the session is not running. It remains `alive` while the runner safely parks
  the sandbox, then normal idle expiry clears `alive`. Settlement updates both Redis and the
  Postgres session-row mirror.
- Every accepted execution reaches exactly one durable terminal outcome.
- The sender and every other reader see the same terminal outcome.
- Runner, sandbox, provider, tool, adapter, and record-delivery failures cannot leave an unbounded
  running state.
- After any terminal failure, the session accepts a new message and continues from its last
  committed history. A failure may lose an unconfirmed tail, but it cannot make the session
  permanently unusable or discard previously committed conversation history.
- Normal Stop preserves the session workspace and leaves the harness session warm and resumable.
- The runner parks a stopped sandbox only after both the harness prompt and any in-flight tool child
  processes have stopped. If a harness cannot prove that state, the runner must destroy or isolate
  that sandbox instead of advertising warm resume.
- A watchdog settles work when the owning runner cannot produce the terminal outcome.
- A slow tool fails with an explicit tool or execution result. It does not disappear silently.

## Steer and concurrent sends

Issues: [#6417](https://github.com/Agenta-AI/agenta/issues/6417),
[#6020](https://github.com/Agenta-AI/agenta/issues/6020),
[#5790](https://github.com/Agenta-AI/agenta/issues/5790),
[#5539](https://github.com/Agenta-AI/agenta/issues/5539),
[#5538](https://github.com/Agenta-AI/agenta/issues/5538).

Observed examples:

> “I expect the platform to queue the message, or to refuse it with a clear signal. Instead both
> turns die and the session refuses every message for 30 minutes.”
> ([#6417](https://github.com/Agenta-AI/agenta/issues/6417))

> “The steering turn itself fails with an error and an empty reply, and every turn I send on that
> session afterwards fails the same way.” ([#6020](https://github.com/Agenta-AI/agenta/issues/6020))

Draft requirements:

- At most one execution is active for a session at one time.
- After an execution reaches a terminal outcome, later output for that execution is rejected with
  a non-retryable conflict. The first release does not add ownership generations or a quarantine
  table. Rejections produce structured logs and metrics.
- A second message uses an explicit `reject`, `queue`, or `steer` policy.
- The API saves an accepted queue or steer message before interrupting current work.
- The API resolves every execution-affecting command to one execution before delivery.
- Public Stop can optionally name the execution the caller expects. If omitted, it targets the
  current execution.
- First-party clients send `expected_execution_id` whenever they know it. A mismatch returns a
  conflict and leaves the current execution untouched.
- A delayed runner cannot append normal output after a terminal execution outcome.
- A failed steer leaves the saved message visible and recoverable.

## Reattach and multiple readers

Issues: [#5609](https://github.com/Agenta-AI/agenta/issues/5609),
[#5542](https://github.com/Agenta-AI/agenta/issues/5542),
[#6404](https://github.com/Agenta-AI/agenta/issues/6404),
[#5611](https://github.com/Agenta-AI/agenta/issues/5611),
[#5443](https://github.com/Agenta-AI/agenta/issues/5443),
[#5384](https://github.com/Agenta-AI/agenta/issues/5384),
[#6397](https://github.com/Agenta-AI/agenta/issues/6397),
[#5990](https://github.com/Agenta-AI/agenta/issues/5990),
[#6388](https://github.com/Agenta-AI/agenta/issues/6388),
[#6468](https://github.com/Agenta-AI/agenta/issues/6468),
[#5950](https://github.com/Agenta-AI/agenta/issues/5950).

Observed examples:

> “A tab that never regains focus misses a run started in another browser.”
> ([#5609](https://github.com/Agenta-AI/agenta/issues/5609))

> “Reload the page. After the reload: The approval card is gone entirely.”
> ([#5542](https://github.com/Agenta-AI/agenta/issues/5542))

Draft requirements:

- Every authorized client can follow one execution concurrently.
- Every connected client receives live frames, not only completed messages.
- Refresh, navigation, and sender disconnection do not stop the execution.
- A snapshot declares the durable event cursor it represents.
- A reader can replay durable events after that cursor and then follow new events.
- Missed temporary frames are repaired by the next durable checkpoint.
- Pending interactions remain visible and actionable after reload.
- Session identity is stable in URLs and across client caches.

## Record durability and ordering

Issues: [#5496](https://github.com/Agenta-AI/agenta/issues/5496),
[#5594](https://github.com/Agenta-AI/agenta/issues/5594).

Observed examples:

> “The session-records pipeline loses records permanently in three separate ways, and reports
> success while doing it.” ([#5496](https://github.com/Agenta-AI/agenta/issues/5496))

> “The records worker rejects the whole batch.”
> ([#5594](https://github.com/Agenta-AI/agenta/issues/5594))

Draft requirements:

- A Redis Stream record is acknowledged only after the Postgres transaction that stores it commits.
- One bad record cannot silently discard unrelated records in the same batch.
- Every durable producer event has a stable producer-generated ID before its first send.
- Identical retries are idempotent and cannot change established event order.
- Progressive tool-call and tool-result frames remain temporary until the runner emits one complete
  durable checkpoint. That checkpoint must commit before terminal settlement.
- Durable replay uses append-only facts with a stable cursor.
- A detected persistence gap marks the session history incomplete.
- The runner gives every durable checkpoint a stable ID before its first send.
- Temporary delivery failures retry with the same ID. A timeout has unknown outcome and also
  retries with the same ID.
- The runner drains required durable writes before terminal settlement for a bounded period.
- The first version may lose an unconfirmed in-memory tail when the runner crashes. The watchdog
  records `lost`, marks history incomplete, releases the session, and allows a new message.
- The system never reports successful completion when durable settlement is unknown.

## Approvals and pauses

Issues: [#6315](https://github.com/Agenta-AI/agenta/issues/6315),
[#6316](https://github.com/Agenta-AI/agenta/issues/6316),
[#6106](https://github.com/Agenta-AI/agenta/issues/6106),
[#5907](https://github.com/Agenta-AI/agenta/issues/5907),
[#5592](https://github.com/Agenta-AI/agenta/issues/5592),
[#5638](https://github.com/Agenta-AI/agenta/issues/5638),
[#5545](https://github.com/Agenta-AI/agenta/issues/5545),
[#5097](https://github.com/Agenta-AI/agenta/issues/5097).

Observed examples:

> “The playground keeps rendering an actionable card whose buttons do nothing.”
> ([#6315](https://github.com/Agenta-AI/agenta/issues/6315))

> “When I answer a parked approval and the resumed run fails to start, the approval is gone.”
> ([#5592](https://github.com/Agenta-AI/agenta/issues/5592))

Draft requirements:

- An interaction has one visible state: pending, resolved, denied, or cancelled.
- Stop cancels pending interactions for the stopped execution.
- A late answer cannot resume a cancelled or replaced execution.
- An answer is not consumed until its continuation has a recoverable outcome.
- Side-effecting tools do not run twice after pause and resume.
- One user-visible conversation turn remains traceable across approval resumes.

## Session list and identity

Issues: [#6419](https://github.com/Agenta-AI/agenta/issues/6419),
[#6463](https://github.com/Agenta-AI/agenta/issues/6463),
[#5969](https://github.com/Agenta-AI/agenta/issues/5969),
[#6457](https://github.com/Agenta-AI/agenta/issues/6457),
[#6031](https://github.com/Agenta-AI/agenta/issues/6031),
[#6214](https://github.com/Agenta-AI/agenta/issues/6214).

Observed example:

> “The session rail shows a session titled with my message, and the conversation is empty.”
> ([#6419](https://github.com/Agenta-AI/agenta/issues/6419))

Draft requirements:

- A user message accepted by the API is never lost when execution fails to start.
- A visible session has an explicit origin and owner type.
- Session list updates converge without requiring a full page reload.
- Rename and archive operations have observable success or failure.
- Session identity does not depend on the browser that created it.

## Requirement status

This file does not yet state priority or implementation order. Some issues may share a cause, and
some may fall outside the final RFC. Each design-track discussion must confirm which requirements
it owns and which linked issues it expects to close.
