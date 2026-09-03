# The stale tail: a thawed runner writing after the watchdog's ending

*Every conclusion in this file is agent-generated and low weight. The live results are
reproducible from the commands given; the judgements about scope and trade-offs are not
reviewed by a human.*

Branch `feat/session-execution-watchdog` (PR #6501), head `3f25f06d64`. Stack
`agenta-ee-dev-session-watchdog` on http://144.76.237.122:8880, Postgres 5442.

## Answer

The defect reproduces on this branch in two minutes, and the fix closes it. A runner frozen
with `docker pause` past the 90-second stale-heartbeat threshold is settled by the watchdog,
and when it thaws it submits the whole tail it had buffered — a tool call, its result, a
`usage`, and a second `done` — three to four seconds after the ending the user has already
read. The transcript reconstruction in `@agenta/chat` renders that as **three bubbles**: the
prompt, a red "the agent stopped responding" notice, and then a second assistant turn showing
the tool the agent went on to run, complete with token accounting and a trace id. The fix adds
one guard at records ingest: once a turn carries the watchdog's own terminal record, any later
record for that turn from any other writer is written with `quarantined_at` set and excluded
from every read that rebuilds a transcript. The same scenario on the fixed code renders **two
bubbles** and one ending, the tail rows are still in the table for support and billing, and the
worker logs a per-batch count. An ordinary Stop, which the watchdog never touches, is
unaffected: five records, one ending, nothing marked. 554 session tests pass against the
stack's live Postgres, 20 of them new, none skipped.

## Scenarios

| Scenario | Provider | Harness | Commit | Result | Timing | Evidence |
|---|---|---|---|---|---|---|
| Stale tail, tool call already flushed | local | pi_core | `3f8f096714` (pristine) | **defect reproduced**: 3 late records, 2 endings | settled 88.9 s after the freeze; tail landed 2.9 s later | `before-fix-records.txt` |
| Stale tail, nothing flushed before the freeze | local | pi_core | `3f8f096714` (pristine) | **defect reproduced**: 4 late records, 2 endings, 3 bubbles | settled 98.0 s after the freeze; tail landed 3.6 s later | `before-fix-2-records.txt`, `before-fix-2-render.txt` |
| Ordinary Stop (control) | local | pi_core | `3f8f096714` (pristine) | 5 records, 1 ending | Stop accepted in 0.07 s | `before-fix-2.json` |
| Stale tail, late `done` only | local | pi_core | `3f25f06d64` (fixed) | **1 late record quarantined**, 1 ending, 2 bubbles | settled 101.7 s after the freeze; quarantined 0.40 s after arrival | `after-fix-records.txt`, `after-fix-render.txt` |
| Stale tail, full tail | local | pi_core | `3f25f06d64` (fixed) | **3 late records quarantined**, 1 ending, 2 bubbles | settled 126.8 s after the freeze; quarantined 0.34 to 0.39 s after arrival | `after-fix-2-records.txt`, `after-fix-2-render.txt` |
| Ordinary Stop (control) | local | pi_core | `3f25f06d64` (fixed) | 5 records, 1 ending, nothing quarantined | Stop accepted in 0.07 s | `after-fix.json` |

Every settle time is the watchdog's own record timestamp minus the freeze, not the driver's
poll, which lags by up to five seconds. The spread above the 90-second threshold is where in
the 60-second sweep interval the freeze happened to fall.

Raw evidence, drivers and logs: `~/agenta-qa-evidence/2026-09-03-session-round2/stale-tail/`.

## Part 1: the proof

### How it is reproduced

`docker pause`, not `docker restart`. The distinction is the whole defect: a restart kills the
process, so the run never unwinds and exactly one pair of records is written. A pause freezes
the runner with its request intact, which is what a wedged or stalled runner looks like from
the API's side, and thawing it makes the wedged `run()` return and submit everything it had
buffered.

```bash
cd ~/agenta-qa-evidence/2026-09-03-session-round2/stale-tail
uv run stale_tail.py --cells stale-tail,normal-stop --tool-wait 8 --out out.json
```

The driver starts a Pi turn whose only instruction is to run `sleep 200`, waits for the tool
call to be in flight, pauses the runner container, polls until the watchdog writes a terminal
record, unpauses, and then reads the records table. It is built from the integration lane's
`integration_live.py`, so the two are comparable.

### What the records table holds

Turn `a6bec90b-d638-42f7-a1af-60b0f7bf642b`, session `0aaff8c8-15b8-478f-8327-dae0cad41858`,
on the pristine branch head. Times are the producer's own, in UTC:

| Producer time | Record | Written by |
|---|---|---|
| 11:55:34.302 | `message`, the user's prompt | the runner |
| 11:57:20.038 | `error`, `code: execution_lost` | the watchdog |
| 11:57:20.039 | `done` | the watchdog |
| 11:57:23.661 | `tool_call` | the runner, on thaw |
| 11:57:23.674 | `tool_result` | the runner, on thaw |
| 11:57:24.439 | `usage` | the runner, on thaw |
| 11:57:24.454 | `done`, with a `traceId` | the runner, on thaw |

The watchdog's own log line for that pass:

```
2026-09-03T11:57:20.039Z [WARN.] watchdog: settled a session_stream whose runner went silent
  extra={'session_id': '0aaff8c8-15b8-478f-8327-dae0cad41858',
         'stream_id': '01a0671f-d409-7593-8def-4bd200ff867b',
         'turn_id': 'a6bec90b-d638-42f7-a1af-60b0f7bf642b', 'lost': True}
```

Four records land after the turn has been given a terminal outcome, and one of them is a second
terminal outcome. That is the RFC invariant broken twice over: one execution reaches two
durable endings, and normal output follows terminal settlement.

### What the reader sees

Those exact rows, fed through `transcriptToMessages` from `web/packages/agenta-chat` after the
same field mapping `@agenta/entities` applies (`record_type` to `session_update`, `attributes`
to `payload`, and so on):

```
BUBBLES=3
{"role":"user","parts":["text"],"text":["The codeword is PLUMD46313. Run exactly this one shell command and nothing else:"]}
{"role":"assistant","parts":[],"metadata":{"runError":{"message":"The agent stopped responding and the run was closed. Send the message again to retry.","code":"execution_lost"}}}
{"role":"assistant","parts":["tool-bash"],"metadata":{"traceId":"c74f6de3084b1c43130a3a0e0c89e6f0","usage":{"input":3,"output":53,"total":2247,"cost":0.00305975}},"toolParts":[{"type":"tool-bash","state":"output-error"}]}
```

The failure notice, and then a whole second assistant turn after it. The mechanism is in
`transcriptToMessages`: a `done` closes the current draft, so the records that follow open a
fresh assistant message.

A second run where the `tool_call` had already flushed before the freeze produced a milder but
still wrong shape (turn `57f8581b-5739-42ed-ab0b-cb40f7a5463d`, `before-fix-records.txt`): two
bubbles, but the tool part inside the failed turn resolves to `output-error` carrying
"INTERRUPTED_BY_USER", so the turn simultaneously says the agent stopped responding and shows a
tool call that reached a conclusion. Which of the two shapes you get depends only on whether
the tool-call record flushed before the freeze.

## Part 2: the fix

### The rule

**Once a turn carries the watchdog's own terminal record, every later record for that turn from
any other writer is quarantined rather than appended as history.**

It lives in `RecordsService.append_many`
(`api/oss/src/core/sessions/records/service.py`), because ingest is the only place the two
writers meet. The guard is scoped in three ways, and each one is load-bearing.

**Only turns the watchdog ended.** The DAO's `settled_turns` gained an optional `settled_by`,
so the guard asks "did the platform end this turn?" rather than "does this turn have an
ending?". A turn that reached its own honest ending never lost the argument with the platform,
so a `usage` that trails its own `done` through the ingest stream is still ordinary history and
an ordinary Stop is untouched. This is the narrowest reading of the RFC requirement that still
closes the defect, and it is deliberately narrower than the requirement's own wording.

**Only records the watchdog did not write.** The watchdog stamps
`attributes.settled_by = "watchdog"` on both records it writes. Without the exemption, a
redelivery of its `error` — which is not a terminal record — after its `done` had landed would
quarantine the very ending it belongs to. A producer cannot forge the marker: the ingest route
at `api/oss/src/apis/fastapi/sessions/router.py:760` builds `SessionRecordEvent` field by field
out of the request body and never reads that key off the wire.

**Terminal records included.** A late `done` is quarantined like the rest of the tail. The
brief offered folding it into the existing ending instead; that would rewrite the record the
user has already read, and would erase the fact that two writers disagreed about how the turn
finished. Quarantining it keeps exactly one effective ending and keeps the disagreement
visible.

One more case the tests pin: a batch that carries the watchdog's own `done` settles that turn
for the rest of its own batch. Ingest batches up to fifty messages and the thawed runner's tail
can share one with the ending that beat it by a second, in which case the database lookup would
find nothing because the ending is not committed yet.

### Quarantine, not reject

Both were on the table. Quarantine wins on three counts.

- **The tail is real work.** A late `usage` carries token accounting that is real money. A
  dropped record cannot be reconciled later; a marked one can.
- **It is the first thing support asks for.** "What did the agent actually do after we told
  the user it had stopped?" is answerable from a marked row and unanswerable from a log line.
- **The cost of quarantine is one predicate.** The row is already invisible to every read that
  rebuilds a transcript, so keeping it costs storage and nothing else.

The argument for reject is a clean table, and the counter-argument is that the table is not
clean either way — reject leaves the same event as a log line nobody indexes.

The mark is a nullable `quarantined_at` timestamp on `records`
(`oss000000005_add_records_quarantined_at`, tracing_oss chain; EE inherits this table, so there
is one migration, not two). `record_source` was NOT reused: it already means "user" or "agent"
and feeds the session-list preview.

### What the mark does

- `get_records` excludes marked rows. That is the read behind both the transcript endpoint and
  the interactions dispatcher's history rebuild, so the fix needed no frontend change at all.
- `latest_message_per_session` excludes them, so a message written after the ending cannot
  become a session's list preview.
- `settled_turns` excludes them, in both its modes. A refused second ending must never stand in
  for the real one.
- The upsert coalesces the column rather than overwriting it, so quarantine is one-way: a
  redelivery keeps the instant of the first mark, and a delivery that somehow arrives unmarked
  cannot resurrect the row.
- A failed lookup quarantines nothing and appends everything. Losing a record is worse than
  showing one that should have been hidden, and the next delivery gets another go.

### The counter

`RecordsWorker.process_batch` logs one line per batch that contains a quarantine, with the
count and the affected turns, beside the per-record warning the service already emits:

```
[RECORDS] Quarantined late records for settled turns
  project_id=01a0672e-... quarantined=2 appended=2
  turns=['27defdfd-...:a498b949-9496-4691-a740-293bbcaee4f2']
```

How often the guard fires is one grep away, and the marked rows themselves are the durable
record.

### What was deliberately not built

No ownership generations, no execution-ownership table, no broad stale-writer rejection. Those
are the RFC's deferred decisions and this guard does not need them. Nothing on the runner
changed: a runner-side guard cannot tell this case from an ordinary Stop, where the heartbeat
also reports `is_current_turn: false` and the runner's own ending is the only one there will
ever be.

## Tests

| Suite | Command | Result |
|---|---|---|
| Late-record guard, service | `pytest oss/tests/pytest/unit/sessions/test_late_record_quarantine.py -q` | 13 passed |
| Late-record guard, DAO (live Postgres) | `pytest oss/tests/pytest/unit/sessions/test_late_record_quarantine_dao.py -q` | 7 passed |
| Whole session suite (live Postgres) | `pytest oss/tests/pytest/unit/sessions/ -q` | **554 passed, 0 failed, 0 skipped** |
| Lint, CI-pinned | `uvx ruff@0.15.12 format` then `check` on `oss/src`, `oss/tests/pytest/unit/sessions/`, `oss/databases` | clean |

Run with the venv from the integration worktree and this stack's database:

```bash
cd ~/code/agenta-2-worktrees/slice-watchdog/api
export POSTGRES_URI_CORE="postgresql+asyncpg://username:password@127.0.0.1:5442/agenta_ee_core"
export POSTGRES_URI_TRACING="postgresql+asyncpg://username:password@127.0.0.1:5442/agenta_ee_tracing"
PYTHONPATH=$PWD ~/code/agenta-2-worktrees/integration/api/.venv/bin/python \
  -m pytest oss/tests/pytest/unit/sessions/ -q
```

The 20 new tests are the delta; the branch had 534 before. Nothing is skipped, including the
DAO tests that need a real database.

The service tests cover, in the brief's own terms: output emitted before termination but
delivered after it (the tail); a normal Stop with one ending, untouched; a second `done` after
the watchdog's ending; and idempotent behaviour on redelivery. They also cover the three ways
the guard must not fire — a turn the runner settled itself, a record with no turn id, and
another turn in the same session — and the two failure paths, a lookup that raises and a batch
spanning two projects.

`test_execution_watchdog.py` needed one change: its assertion on the exact attributes of the
watchdog's two records now names the writer marker, and says why it is there.

## Part 3: the live verification

Same stack, same driver, after the fix. The API bind-mounts source, and the reload was
confirmed in the container log; the migration was applied with
`python -m ee.databases.postgres.migrations.runner` (`oss000000004 -> oss000000005`) and the
column verified with `\d records`. `worker-streams`, which hosts the records worker, was
restarted so it ran the new service code.

Turn `a498b949-9496-4691-a740-293bbcaee4f2` — the same shape as the pristine reproduction:

| Producer time | Record | `quarantined_at` |
|---|---|---|
| 12:11:59.091 | `message` | — |
| 12:12:11.149 | `tool_call` | — |
| 12:14:17.792 | `error`, `code: execution_lost` (watchdog) | — |
| 12:14:17.793 | `done` (watchdog, `settled_by: watchdog`) | — |
| 12:14:23.146 | `tool_result` (runner, on thaw) | **12:14:23.539** |
| 12:14:23.968 | `usage` (runner, on thaw) | **12:14:24.310** |
| 12:14:23.997 | `done` (runner, on thaw) | **12:14:24.310** |

Every late record is marked, within 0.4 seconds of arrival. What the records endpoint returns
for that session is four rows, not seven, and the transcript reconstruction gives:

```
BUBBLES=2
{"role":"user","parts":["text"],"text":["The codeword is PLUM819243. Run exactly this one shell command and nothing else:"]}
{"role":"assistant","parts":["tool-bash"],"metadata":{"runError":{"message":"The agent stopped responding and the run was closed. Send the message again to retry.","code":"execution_lost"}},"toolParts":[{"type":"tool-bash","state":"input-available"}]}
```

Three bubbles became two, and the tool part now rests at `input-available` — the honest state.
The call was issued and the platform closed the turn before its result was known, which is
exactly what happened.

The control ran in the same session as the first fixed run: an ordinary Stop, five records, one
ending, nothing quarantined.

### Reproducing it

```bash
cd ~/code/agenta-2-worktrees/slice-watchdog
set -a && . hosting/docker-compose/ee/.env.ee.dev.watchdog && set +a
bash ./hosting/docker-compose/run.sh --license ee --dev --env-file .env.ee.dev.watchdog --no-tunnel

cd ~/agenta-qa-evidence/2026-09-03-session-round2/stale-tail
export AGENTA_BASE=http://144.76.237.122:8880
export AGENTA_ADMIN_KEY=...   # AGENTA_AUTH_KEY from that env file
export QA_OPENAI_API_KEY=...  # OPENAI_API_KEY from ~/.agenta-qa-openai.env
uv run stale_tail.py --cells stale-tail,normal-stop --tool-wait 8 --out out.json

docker logs -f agenta-ee-dev-session-watchdog-worker-streams-1 2>&1 | grep -a Quarantin
```

The QA OpenAI key was loaded from `~/.agenta-qa-openai.env` into each ephemeral project's vault
through `POST /vault/v1/secrets/` at bootstrap, by the driver, at 13:38, 13:44, 13:55, 14:03 and
14:11 local time. No credential value appears in this file, in the evidence directory, or in the
repository.

**The stack has been torn down** with `--down` (volumes kept) after these runs.

## Commits

| SHA | What |
|---|---|
| `ba762d6786` | `records.quarantined_at` plus the `settled_by` attribute contract, the migration, the DTOs and the mapping |
| `499f92c658` | the watchdog stamps itself as the writer of its ending |
| `a25bd9f1e9` | the DAO: marked rows out of every transcript read, `settled_by` on `settled_turns`, one-way upsert, 7 DAO tests |
| `3f25f06d64` | the ingest guard itself, the worker counter, 13 service tests |

Branch head `3f25f06d64`. Not pushed.

## Open questions for Mahmoud

1. **Should the guard key on the watchdog's ending, or on ANY terminal record?**
   *Recommendation: keep it on the watchdog's, as built.* The RFC's wording is broader, and the
   broader rule is one predicate away. But keying on any ending puts the guard in the path of
   every normal turn, where the runner legitimately flushes a `usage` and a `done` in the same
   breath and a reordered stream would start quarantining real history. The narrow rule closes
   the observed defect and cannot misfire on a healthy turn. Widen it only with evidence that
   something else writes late.

2. **Should a quarantined `usage` still count for billing?**
   *Recommendation: yes, and that is why this is a quarantine.* The tokens were spent. Nothing
   reads `usage` for billing today, so this is a decision to make once something does, and the
   rows are there when it does. The alternative — rejecting the record — makes the question
   unanswerable.

3. **Does a quarantined tail deserve to be visible in the product at all?**
   *Recommendation: not now.* A support engineer can query the column; a user seeing "the agent
   also did this after we gave up" is worse than the current silence. Worth revisiting only if
   the counter shows this happening often enough for users to notice the missing work.

4. **Should the watchdog also close the turns ledger for a settled turn?**
   *Recommendation: still not in this slice*, unchanged from the watchdog slice's own question.
   `session_turns.end_time` stays NULL on a lost turn. This lane did not touch it, and nothing
   in the transcript depends on it.

5. **Should the same guard cover the commands plane?**
   *Recommendation: not yet.* The integration lane wired command settlement into the same sweep,
   and a command has one writer and one settle path, so the two-writer race this guard exists
   for does not arise there today. If runner-initiated long polling lands (AGE-4253) it will,
   and the same shape applies.
