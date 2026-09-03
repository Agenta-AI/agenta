# Decision list for the RFC edit (lead, from three reviews; agent-generated, low weight)

Reviews: reviews/fable-2026-09-03.md, reviews/opus-practices-interfaces-2026-09-03.md,
reviews/codex-gpt-5.6-sol-2026-09-03.md, reviews/qa-audit-2026-09-03.md. Track C measurement:
live-frame-envelope.md. All in the RFC worktree.

## Part 1: apply to the RFC (two or three reviewers agree, lead verified the code claims)

A1. Sequence allocation moves off `session_streams`. Records live on the analytics engine
    (records/dao.py:28, tracing_oss migrations); `session_streams` is core_oss. Persistence
    contract: a small per-session cursor row owned by the records domain, on the analytics
    engine, additive. Record as blocking decision (Option 1 cursor table on analytics engine /
    Option 2 move records to core; recommend 1) in open-questions.md.
A2. Cut `POST /sessions/{id}/commands` (Send) from version one. Keep invoke; add `on_busy` and
    `Idempotency-Key` there. The command table stays private. A public route for Queue and
    Steer is decided with that package. (All three reviewers.)
A3. Add a section "Flags and rollback" to rfc.md and a flag column to plan.md. Version one uses
    env-backed server switches through env.py (never os.getenv): `AGENTA_SESSIONS_DURABLE_STOP`
    for increment 2, `AGENTA_SESSIONS_HISTORY_WRITES` for increment 3,
    `AGENTA_SESSIONS_SHARED_READER` for increment 4. Each flag names its rollback (flip off;
    old path stays mounted). Project allowlists (Codex) recorded as Option 2 in open-questions.
A4. Collapse the six milestones to increments in this order: (1) pure fixes #6502 and #6500;
    (2) Stop and recovery behind the flag; (3) history producer plus retention separation, no
    client change; (4) shared reading for secondary readers (relay + sequence + snapshot +
    one reducer, sender stays on invoke); (5) sender on the shared path; (6) durable approvals;
    (7) Queue, then Steer. Merge work-packages/shared-client-reader.md into live-relay.md.
    Split approvals out of queue-steer-approvals.md as the earlier increment.
A5. Retention separation is the first task and a completion gate of the history package.
    records_worker.py drops over-quota records today; state it.
A6. Reuse the existing records ingest stream for temporary frames. Envelope gets an explicit
    `kind: frame | event`; frames carry `frame_index` per execution (Track C); durable events
    carry `sequence`. Take the field list and the measured limits from live-frame-envelope.md
    into contracts/events.md; retention: MAXLEN per stream sized from the long case
    (about 3,200 frames, 200 KB per turn).
A7. Freeze only the six first-increment events with payloads: execution.started,
    execution.stopped, execution.failed, execution.lost, message.completed, tool.completed.
    Versioned envelope; unknown event types are ignored by the reducer. Defer the rest.
A8. One error table in contracts/public-api.md using the repository envelope
    {code, message, retryable, next_step?, details?} and existing codes. Drop
    `503 admission_unavailable`. Idempotency: the DAO must compare the request under a reused
    key and return 409 on a different body; first-party Stop sends an idempotency key.
A9. Keep `POST /sessions/{id}/cancel` as the public Stop route in version one; do not add
    `/stop`. Spelling stays with API review. (Codex prefers /stop; recorded as an option.)
A10. commands.md: describe the port that exists: `deliver(command) -> receipt`; settlement,
    retry scheduling, and recovery live in the service. Do not reuse
    streams/runner_client.py for Stop (it swallows failures by design).
A11. Delivery recovery rule: a `pending` command whose session still beats is redelivered by
    the sweep with the same command id (bounded attempts); a `pending` command whose runner is
    gone settles `lost`. Today the sweep skips the first case (commands/service.py, the
    `_session_is_beating` branch). Add to the Stop sequence, commands.md failure rules, and
    the Stop package as a fix on #6503.
A12. One terminal outcome is enforced by the database, not by a reader filter: settlement is a
    compare-and-set on the execution row (terminal fields set only when null). The watchdog
    and the runner both go through it. Late records are guarded by that row's terminal state,
    for every terminal cause, not only the watchdog's. Put in persistence.md and the Stop
    package; implementation on #6501/#6503.
A13. Settlement atomicity: the command settle, the stopping marker clear, the mirror write,
    and the interaction cancel happen in one transaction where they share a database; the
    Redis liveness write happens after commit and is idempotent, and the sweep repairs a
    missed Redis write. State it in architecture.md "Stop sequence".
A14. Watchdog is the second writer: it writes the ending, clears `running`, releases `alive`,
    and updates the mirror when the runner cannot. Each sweep pass is bounded and a timed-out
    pass is logged. Add to architecture.md, the Stop sequence, and qa.md.
A15. Desktop Stop: the client shows "stopping" until the Stop request is accepted, then
    "stopped" on the terminal event; a failed request restores the running state. Add to
    public-api.md client rules and the Stop package (fix on #6504).
A16. Recovery SLO: an abandoned execution settles within 150 s (90 s stale + 60 s sweep) and
    the client shows "recovering" in that window. Stop latency: 5 s is the alert threshold;
    measured under 300 ms; over 1 s needs a written reason in the release notes.
A17. Event authorization: re-check project access on a bounded interval or bound the
    connection lifetime (for example 15 min, client reconnects). Frame ingress is bound to the
    owner claim (execution id and owner), not the shared runner token alone. Logs carry
    identifiers only, never message content or tokens.
A18. Legacy writes after migration: every durable write after the migration, including old
    endpoints, allocates a sequence; a write path that cannot is turned off behind the history
    flag. Say it in persistence.md "Legacy records".
A19. Client packages named: `web/packages/agenta-entities/src/session` (API and state),
    `web/packages/agenta-chat` (transport and reducer), `web/packages/agenta-sessions/src/watch`
    (SSE). New session calls go through the Fern client; SSE is the stated exception.
    Storybook stories for the new client states are a qa.md row.
A20. Snapshot grouped by role: {session, execution, pending, read: {latest_sequence,
    history_complete}}. The guard has one name on both sides: `expected_execution_id`.
    Typed payload per command type. Snapshot has a size rule (page the transcript).
A21. Stop package: replace the slice list with the PR order and bases: #6502, #6500 on main;
    #6496 on main; #6503 on #6496; #6501 on #6503; #6504 on #6503. The integration branch is
    evidence, not a merge source.
A22. qa.md: add a "Proven" column (commit, provider, harness, evidence path) from
    qa-audit-2026-09-03.md; add rows: Stop while the execution completes, Stop and approval
    response in one window, client retry after a lost response, duplicate delivery, malformed
    record in a batch, API death after command commit, API death during settlement, SSE auth
    revocation, feature rollback, bounded sweep pass; and the Storybook row.
A23. Claude Code shell permission moves to a Linear security issue; requirements.md links it.
A24. Trim rfc.md scope limits to four deferrals: Postgres ownership, ownership generations,
    multi-runner guarantees, permanent token storage.
A25. Minimal metrics named before release: command admitted/delivered/applied/obsolete/lost
    counters, Stop delivery latency histogram, harness cancel latency, watchdog settlements,
    quarantined or rejected late records, sweep pass duration.

## Part 2: open for Mahmoud (write as Option 1 / Option 2 with recommendation in open-questions.md)

O1. Sequence home: cursor table on the analytics engine (recommend) vs move records to core.
O2. Late output: quarantine (Fable, Opus recommend: built, keeps usage and tool result, one
    predicate on reads) vs reject (Codex recommends: fail closed, no second class of rows).
    Code stays quarantine behind the flag until decided.
O3. Codex child: ship the reap from #6496 now, pin bump 1.1.7 -> 1.8.0 as a separate PR
    (recommend) vs bump first.
O4. Rollout granularity: global env switch per increment (recommend for version one, simpler)
    vs kill switch plus project allowlist plus capability advertisement (Codex).
O5. Stop verb: keep /cancel (recommend) vs add /stop.
O6. Runner stop grace period in the shared compose file (needs a number above 15 s).
O7. `not_running` vs `lost` past teardown on the `running` key (multi-runner only).
