# Spike D: stable record-ID semantics

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

This spike is the gate `records-invariants.md` requires before any immutable-history work. It
answers one question: what breaks today if the records table changes from
`ON CONFLICT DO UPDATE` to `ON CONFLICT DO NOTHING`.

Every claim marked **verified** was read in code at the cited `path:line` or proven by a test in
this branch. Every claim marked **reported** comes from an earlier document and was not re-checked.

## The answer

One case breaks, and it is a producer bug, not a storage requirement.

Three kinds of repeated `record_id` exist. Two of them are already correct under an immutable
insert:

- An exact delivery retry sends the same payload twice. An immutable insert is the right handling.
- A resume re-emission never collides at all, because the turn id is part of the id and every
  resume mints a new turn.

The third kind, a progressive update inside one turn, loses data under an immutable insert. It
happens when a tool call is written to storage before its arguments have arrived, and a later
snapshot repairs the row. Under `DO NOTHING` the durable tool call keeps empty arguments forever,
and the harness is later told the agent ran a command with no arguments.

That early write has two causes, both in `services/runner/src/sessions/persist.ts`, and both are
fixable in the producer without touching storage:

1. The emitter keeps one open tool slot for the whole turn, so a second tool call flushes the
   first one early (`persist.ts:304-321`).
2. A three second idle timer flushes an open tool call that is still streaming its arguments
   (`persist.ts:233`, `:278-294`).

Fixing the producer also removes a defect that is live today. The upsert overwrites `timestamp`
(`api/oss/src/dbs/postgres/sessions/records/dao.py:131`), which is the primary read-order key
(`dao.py:157-161`). A repaired tool call therefore re-sorts after the call that flushed it, and the
transcript shows two parallel tool calls in the wrong order.

Recommendation, in one line: land the producer fix first as its own change, then Option A.
Section 5 gives the evidence.

## 1. Inventory of durable record producers

The runner is the only producer. Verified: the only non-test caller of
`POST /sessions/records/ingest` is `services/runner/src/sessions/persist.ts:91`. Nothing in
`sdks/python` or `services/` writes records; the SDK only carries a `turnId` onto the `/run`
request (`sdks/python/agenta/sdk/agents/utils/wire.py:173-174`).

The stable id is `uuid5(RECORD_NAMESPACE, "<sessionId>:<toolCallId>:<recordType>:<turnId>")`
(`services/runner/src/sessions/record-id.ts:41-50`). Verified. Everything else sends no id and the
API mints a fresh uuid4 per ingest
(`api/oss/src/dbs/postgres/sessions/records/mappings.py:20`). Verified.

| Producer | Record types | How the id is built | When the same id is sent again | Payload difference between sends |
| --- | --- | --- | --- | --- |
| Open tool slot, flushed by `flushOpenTool` (`persist.ts:278-294`) | `tool_call` | uuid5, includes `turnId` | A different tool id flushes the slot and the first id returns; or the idle timer fires and later snapshots arrive | **Different.** The first send often carries `input: {}`; the later send carries the real arguments |
| Tool and interaction branch (`persist.ts:390-408`) | `tool_result`, `interaction_request`, `interaction_response` | uuid5, includes `turnId` | The emitter sees the same event twice inside one turn | **Same** for a re-emitted approval answer (`run-turn.ts:736-751`). **Different** when a placeholder result precedes the real one (`tracing/otel.ts:1979-1993`) |
| Catch-all branch (`persist.ts:411-421`) | `message`, `thought`, `done`, `usage`, `error`, `data`, `file`, `attachment_delivery` | None. API mints uuid4 | Never collides. A duplicate emit or a lost HTTP response creates a second row | Not applicable; no dedup is possible |
| Coalesced text (`persist.ts:338-386`) | `message`, `thought` | None | One send per `*_end` marker | Not applicable |
| Out-of-band user turn (`persist.ts:424-438`, called from `server.ts:559-563`) | `message` with source `user` | None | Guarded by `tailIsFreshUserMessage`, so a resume does not re-send the prompt | Not applicable |
| Ingest endpoint (`api/oss/src/apis/fastapi/sessions/router.py:743-770`) | Pass-through | Does not mint or change ids | Not applicable | Truncates `attributes` at 64 KB before Redis (`core/sessions/records/streaming.py:23`) |
| Records worker (`tasks/asyncio/sessions/records_worker.py:238`) | All | Not applicable | Collapses in-batch duplicates first (`dao.py:99-121`), then upserts | The collapse keeps the last payload, matching what sequential upserts would produce |

Three readers consume records. All three were verified.

| Reader | Path | What it uses records for |
| --- | --- | --- |
| Runner harness reconstruction | `services/runner/src/sessions/reconstruct.ts` | Rebuilds `ChatMessage[]` so a client can send only the newest message |
| API approval resume | `tasks/asyncio/sessions/interactions_dispatcher.py:70` | Rebuilds wire messages for an out-of-band approval reply |
| Browser transcript | `web/packages/agenta-chat/src/assets/transcriptToMessages.ts` | Rebuilds `UIMessage[]` for replay rendering |

`RecordsDAO.append`, the single-row upsert, has no production caller. Verified: every ingest goes
through Redis and `append_many`. It is reachable only from tests.

## 2. Classification of every repeated id

| Case | Class | Does the id repeat? | What an immutable insert breaks |
| --- | --- | --- | --- |
| One tool call, three argument snapshots, then a result | Not a repeat. Coalescing sends one final `tool_call` | No | Nothing |
| Two tool calls in flight, the first announced with empty arguments | **Progressive update** | Yes, same turn | **The arguments.** The durable row keeps `input: {}` and the rebuilt conversation tells the model the agent called the tool with nothing |
| One tool call whose arguments stream past the three second idle window | **Progressive update** | Yes, same turn | Same as above |
| A placeholder `tool_result` followed by the real output | **Progressive update** | Yes, same turn | **The output.** The durable result keeps `""` |
| The same `interaction_response` re-emitted for a token already resolved in this turn | **Exact retry** | Yes, same turn | Nothing. This is the case immutability handles correctly |
| An approval answer re-emitted in a later turn after a resume | **Resume re-emission** | No. The turn id is part of the id, so it is a new row | Nothing. It is already append-only, but the duplicate becomes visible in a replay cursor |
| A `tool_call` in turn one paired with its `tool_result` in turn two | Not a repeat | No | Nothing, provided readers keep binding by `attributes.id` rather than by turn |
| A `done` terminal event sent twice | Neither. It carries no id | No | Nothing today, but immutability cannot deduplicate it either, so a lost ingest response still duplicates a terminal fact |

Two facts make the progressive-update class small and fixable.

**Every resume mints a new turn id.** `_start_turn` generates a fresh uuid7 for send, steer and
resume (`api/oss/src/core/sessions/streams/service.py:947`), and the runner uses the request's turn
id when present (`services/runner/src/server.ts:186-190`). Verified. So an upsert can only ever
fire inside one turn. There is no cross-turn overwrite path.

**The progressive updates all come from one design choice.** The emitter holds at most one open
tool call and flushes it whenever anything else happens (`persist.ts:271-276`, `:304-324`). Both
progressive-update paths disappear if the slot becomes one entry per tool id with no early flush.
The idle timer must stay, because a harness may never close a streaming call
(`persist.ts:228-232`), but it only needs to fire at turn end rather than after three seconds of
silence.

## 3. Defect findings

### Confirmed: a dropped record never marks the session incomplete

Verified in code and pinned by a test.

`flush()` calls `takePersistFailures`, which reads **and clears** the per-session drop counter
(`persist.ts:448`, `:203-207`). The run handler then calls `takePersistFailures` again in its
`finally` block to decide whether to call `noteRecordsIncomplete` (`server.ts:608-616`). Both exit
paths await `flush()` first: the success path at `server.ts:588` and the throw path at
`server.ts:602`. The count at `server.ts:609` is therefore always zero.

`noteRecordsIncomplete` is unreachable in practice. The guard it feeds,
`recordsIncomplete()` at `engines/sandbox_agent/reconstruct-history.ts:85`, is meant to fail a turn
rather than rebuild model context from a log with a hole in it. Today a dropped record writes a
warning line and the next turn reconstructs from the incomplete log.

**Proposed fix, not applied.** Make `flush()` return the count and let the run handler act on it:

```ts
// persist.ts — flush()
const dropped = takePersistFailures(sessionId);
if (dropped > 0) log(`WARN ...`);
return dropped;

// server.ts — replace the finally-block re-read
if (sessionOwned && sessionId && droppedThisTurn > 0) {
  noteRecordsIncomplete(sessionId);
}
```

I did not apply it, because it is not obviously safe. Enabling the guard turns a silent context
hole into a hard turn failure, and `incompleteSessions` is a process-lifetime `Set` that is never
cleared (`persist.ts:210-225`). One dropped record would disable a session for the life of the
runner process. That is a product decision, not a spike decision. See the open questions.

### Confirmed: comments claim an id-based order that never existed

Four comments were wrong. I corrected all four in a separate commit. The change is comment-only.

| File | What it said | What is true |
| --- | --- | --- |
| `web/packages/agenta-chat/src/assets/transcriptToMessages.ts:30` | rows arrive ordered by a uuid7 `id` | Ordered on `(timestamp, created_at, record_index)` (`dao.py:157-161`) |
| `web/packages/agenta-entities/src/session/api/api.ts:61` | events ordered by a uuid7 `id` | Same |
| `services/runner/src/sessions/records-query.ts:33` | ordered by ingest time, then `record_index` | Producer `timestamp` leads, then `created_at`, then `record_index` |
| `services/runner/src/sessions/reconstruct.ts:7` and `:86` | ordered by ingest time / `created_at`, then `record_index` | Same |

No uuid7 is minted anywhere on this path. Verified: `record_id` is a uuid5 for tool-family records
and a uuid4 otherwise, and neither is time ordered.

### Also found, outside the brief

**The records worker acknowledges records it never wrote.** `processed_ids.append(msg_id)` runs
during deserialization (`records_worker.py:177`), before the Postgres write is attempted. A failed
`append_many` logs and continues (`:242-248`) without removing those ids, and the consumer loop
then acknowledges and deletes them from Redis (`shared/consumer.py:193`, `:144-155`). Verified.
This is an acknowledgement bookkeeping defect, not a Redis Streams limitation. It matters for
immutability because an immutable history has no repair path: a lost row stays lost.

**Enterprise record retention has never worked.** `api/ee/src/dbs/postgres/sessions/records/dao.py:105`
and `:119` reference `RecordDBE.id`. That attribute does not exist; the key is
`(project_id, record_id)`. Verified by importing the model:
`hasattr(RecordDBE, "id")` is `False`. Any call to the retention flush raises before it deletes
anything. This is a migration input, not a records-model defect. See section 5.

## 4. Tests added

Both files pass on current behavior. Each test carries a comment that names what must change when
inserts become immutable.

`services/runner/tests/unit/record-id-semantics.test.ts` — 9 tests. The file includes a small
store simulator that applies either the current upsert rule or `ON CONFLICT DO NOTHING` to the
POST bodies the runner actually sends, then feeds the resulting rows to the real
`reconstructMessages`. Each scenario is asserted under both policies, so the loss is visible rather
than argued.

| Test | What it pins |
| --- | --- |
| Re-emitting one `interaction_response` inside a turn | Exact retry. Both policies agree |
| Three argument snapshots then a result | Coalescing sends no repeat. Both policies agree |
| Interleaved tool calls re-open a flushed id | The same id is sent with `{}` then with real arguments. Upsert repairs the arguments but re-sorts the row after the call that flushed it. Immutable insert keeps the order and loses the arguments |
| The idle timer flushes early arguments | Same class, single tool call |
| A `tool_result` sent twice in one turn | Upsert keeps the real output; immutable insert pins it to `""`. Asserted through `reconstructMessages` |
| A resume re-emits the answer under a new turn | No cross-turn id collision. Reconstruction identical under both policies |
| The same gate re-raised in a later turn | Two durable rows for one logical answer, under both policies |
| A `done` event sent twice | Two rows under both policies, because no stable id is sent |
| `flush()` clears the drop count | The defect above, pinned |

`api/oss/tests/pytest/unit/sessions/test_records_upsert_semantics.py` — 8 tests, against the real
`RecordsDAO._dedupe_values`, `RecordsDAO._UPSERT_UPDATED_COLUMNS`, `map_record_event_to_dbe` and
`build_wire_messages`.

| Test | What it pins |
| --- | --- |
| The upsert overwrites exactly six columns | The contract the rest of the file depends on |
| A progressive tool-call repeat | Arguments repaired, ordinal kept, timestamp moved, row re-sorted |
| A repeated `tool_result` | Last output wins today, empty output wins under immutable insert |
| A resume in a later turn | Two distinct uuid5 ids, so both policies append |
| A terminal event | Two distinct uuid4 ids; no dedup is possible at any storage policy |
| Wire-message reconstruction | The out-of-band approval resume loses the tool arguments under immutable insert |
| Dedupe keeps the first row identity | `record_index` and `session_id` come from the first write |
| `record_id` is unrelated to time | Neither uuid4 nor uuid5 can serve as a replay cursor |

## 5. Option A versus Option B, on this spike's evidence

Recommendation: **Option A**, repair records, with the producer fix landing first as its own change.

The evidence that points to A:

- **There is one producer and three readers.** Verified. A second permanent log would have to be
  kept consistent with the first, and this spike found no fan-in problem that a second log solves.
- **Only one repeated-id class breaks, and it is producer-side.** Two of the three classes are
  already correct under an immutable insert. The third disappears when the emitter keeps one open
  slot per tool id instead of one for the whole turn.
- **The fix pays for itself immediately.** The same change removes the live transcript-ordering
  defect caused by the upsert moving `timestamp`. That defect exists today, independently of the
  RFC.
- **Records already carry turn and span columns** (`dbes.py`, migration `oss000000004`), so
  execution lifecycle facts have a home without new schema.

The evidence that argues for B, and why it does not decide the question:

- **Records live in the tracing database, not the core database.** Verified: the DAO uses
  `AnalyticsEngine` (`dao.py:20,26`). If session history must outlive tracing retention, records
  cannot hold it as they stand. That argues for **moving** the table, not for adding a second
  permanent log next to it.
- **Attributes are truncated at 64 KB before Redis** (`streaming.py:23`). An immutable event that
  was truncated has no repair path. A separate event table would face the same limit unless it
  stores lifecycle facts only, which are small. This is a real point for B, but it applies to
  payload-carrying events, not to the lifecycle events the RFC needs.

### Migration risk for old rows

- **Volume.** About 208,000 rows in the shared dev database, with zero carrying an `updated_at`
  (reported, from the earlier records-model report; not re-measured here).
- **No cursor column exists.** Adding a monotonic cursor means backfilling every existing row. The
  only order available for a backfill is the composite the reader already uses,
  `(timestamp, created_at, record_index)`. That order is good enough for a backfill: old rows only
  need to be readable and correctly ordered, never replayable from a live cursor. Once written the
  backfilled value is stable.
- **Old rows carry mixed id families.** uuid5 for tool-family rows, uuid4 for everything else, and
  504 legacy rows with `record_source: runner` from early July 2026 (reported). A cursor column
  sidesteps all of this, because the id stays what it is.
- **Retention has never run.** Because the Enterprise retention flush raises on `RecordDBE.id`
  (verified), no records have ever been aged out. Two consequences. The current table is a full
  history rather than a retained window, which makes a backfill larger but simpler. And fixing
  retention later would start deleting session history, so the retention question in the open
  questions must be answered before that fix ships.
- **An upsert leaves no trace.** `updated_at` is never written (it is absent from the update set at
  `dao.py:128-134`). Verified. So there is no way to identify, in existing data, which rows were
  ever rewritten. A migration cannot distinguish a repaired row from a first write. It does not
  need to: the stored payload is the end state either way.

## Open questions for Mahmoud

1. **Must durable session history outlive tracing-record retention?**
   Recommendation: answer this before any storage change. If yes, move the records table to the
   core database rather than adding a second permanent log. Reason: a second log buys a separate
   retention policy at the price of a consistency invariant between two histories, and this spike
   found no other reason to pay it.

2. **Should the open-tool-slot fix land now, as its own change, ahead of the RFC work?**
   Recommendation: yes. One slot per tool id, no flush on a different id, timer only at turn end.
   Reason: it removes both progressive-update paths and it fixes a transcript-ordering defect that
   is live today. It is small, it is testable with the tests in this branch, and the immutability
   decision then has nothing left to break.

3. **When the drop counter is fixed, should `recordsIncomplete` stay set for the life of the runner
   process?**
   Recommendation: no. Scope it to the turn, or clear it once a later records read succeeds.
   Reason: as written, one dropped record disables reconstruction for that session until the runner
   restarts, which is a larger outage than the hole it protects against.

4. **Should the records worker acknowledge only after the Postgres write commits?**
   Recommendation: yes, and before immutability, not after. Reason: an immutable history has no
   repair path, so a silently acknowledged unwritten record becomes a permanent gap rather than a
   row a later write would have fixed.

5. **Do terminal and message records need producer-generated stable ids in version one?**
   Recommendation: yes for `done` and `error`, no for `usage` and `thought`. Reason: a lost ingest
   response on a terminal event duplicates it, and the browser closes an assistant message on every
   `done` (`transcriptToMessages.ts:567-587`), so a duplicate splits one turn into two bubbles. The
   change is one more `stableRecordId` call in `persist.ts`.

## What this spike did not do

- It did not change any behavior. The only source edits are four comment corrections.
- It did not select Option A or Option B. Section 5 is evidence and a recommendation.
- It did not measure the shared dev database. Row counts are quoted from the earlier report and
  marked reported.
- It did not test against a live Postgres. The DAO tests exercise the real statement builder and
  the real dedupe function, not a real database. Forty-one tests in
  `api/oss/tests/pytest/unit/sessions/` skip without a reachable Postgres, all of them in
  `test_wp5_dao_fanout.py`. They were already skipping before this branch.
