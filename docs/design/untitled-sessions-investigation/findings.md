# Untitled sessions investigation (OSS deployment)

Read-only investigation of the "Untitled chat" / "Untitled session" rows in the sessions
UI, why they are untitled, and why clicking them goes nowhere. No data was modified.
Evidence comes from three sources: the frontend code, the backend and SDK code, and the
live OSS database (`agenta-oss-team-postgres-1`, databases `agenta_oss_core` and
`agenta_oss_tracing`, queried 2026-08-12).

**This document describes the system BEFORE the fix, as of 2026-08-12.** Every count,
percentage, and code reference below is the measured pre-fix baseline and is left
unchanged so the numbers stay comparable. Options 1 to 4 of §8 were implemented in the PR
that carries this file; option 5 (backfill) was declined and option 6 went to a GitHub
issue. For what actually landed and what is still open, read
[HANDOFF.md](HANDOFF.md).

## 1. Executive summary

Two separate defects produce the symptom, and they share one root cause: **the browser
is the only component that ever writes a session title, and the browser is also the only
reliable writer of complete workflow references.** Any session that no browser ever
rendered is untitled forever, and any session whose references were written by a
headless path is missing the reference family the UI needs to open it.

Observations (all measured, not inferred):

- 7,948 sessions total in the OSS core DB; 7,836 (98.6%) have `name IS NULL`. There are
  zero blank or whitespace titles; untitled always means SQL NULL.
- **Not one UI-created session is untitled.** All 100 sessions created by a signed-in
  user outside the trigger path have titles. All 7,836 untitled sessions were created
  headlessly (runner heartbeat, `created_by_id IS NULL`) or by the trigger dispatcher.
- **No untitled session ever had a streaming invocation.** All 139 untitled sessions
  with traces ran with `ag.flags.stream = false`; titled sessions stream in 744 of 750
  traces. Streaming equals "a browser was attached", which equals "the auto-title
  effect ran".
- **No untitled session has a complete workflow reference family.** 98.2% have no
  references at all; the rest carry a bare variant-only or artifact+revision partial
  set. Complete references (workflow + variant + revision) imply titled, in 63 of 63
  cases.
- The unclickable rows are explained by the frontend using two predicates that
  disagree: a row is *shown* if it has references OR a name OR a last message OR a
  trigger, but it is *openable* only if an agent id can be derived from its references.
  Rows with no references swallow the click silently; rows with a variant-only
  reference navigate to `/apps/<variant-id>/playground`, a dead route.

Interpretation (high confidence): the population splits into a dominant historical
block (7,691 sessions that predate the 2026-07-24 auto-title and 2026-07-28 turn
tracking) and two live producers that still generate 10–25 untitled sessions per day:
headless invocations through the workflow service (the `test_run` platform tool is the
canonical and confirmed member of this class) and scheduled trigger runs.

## 2. Population and method

- Population: every row in `agenta_oss_core.session_streams` (7,948 rows, 8 projects,
  2026-07-06 through 2026-08-12). This is the table behind `POST /sessions/query`,
  which populates every session list surface. No sampling for the aggregates; deep
  dives used representative sessions from each metadata shape.
- The UI renders a fallback string when the session's `name` is NULL and no local or
  expanded preview is available. The literal "Untitled chat" appears only in the
  playground's local session rail
  (`web/oss/src/components/AgentChatSlice/components/SessionRail.tsx:284`); every
  server-backed list says "Untitled session"
  (`web/packages/agenta-sessions/src/row/sessionRowTitle.ts:8-17`). Both fall back only
  after name, preview, and (rail only) local first-message text all come up empty.
- The list endpoint applies no turn-existence filter
  (`api/oss/src/dbs/postgres/sessions/streams/dao.py:289-343`). The frontend hides
  "not started" rows client-side
  (`web/packages/agenta-sessions/src/state/sessionListPolicy.ts:35-45`).
- Classification signatures were derived from code, then applied to the DB:
  `created_by_id IS NULL` = created by a runner heartbeat
  (`api/oss/src/core/sessions/streams/service.py:569-577` passes `user_id=None`);
  `tags->>'ag.origin' = 'trigger'` = trigger dispatcher claim
  (`api/oss/src/dbs/postgres/sessions/streams/dao.py:194-210`); reference array shape
  and the tracing DB (joined via `session_turns.trace_id`; `spans.session_id` is NULL
  on all rows) supplied the rest.

## 3. Findings by provenance

| Shape | Count | % of untitled | Window | Evidence |
|---|---|---|---|---|
| A. Legacy, predates turn tracking | 7,691 | 98.2% | 07-06 → 07-27 | Zero `session_turns` rows exist before 2026-07-28; first title appears 2026-07-28. 7,586 belong to one project's bulk workload (07-06 → 07-13, up to 1,451/day) that then settled into one cron-like session per day at 09:01 UTC, still firing. |
| B. Modern, zero turns | 5 | 0.06% | 07-28 → 08-12 | Stream row exists, no turn ever landed. |
| C. Scheduled trigger runs | 28 | 0.36% | 08-11 → 08-12 | `tags` carry `ag.origin=trigger`, `ag.trigger.kind=schedule`, `ag.trigger.id`, `ag.trigger.delivery_id`. No `subscription` deliveries exist yet. |
| D. Modern headless invocation | 113 | 1.44% | 07-29 → 08-12 | `created_by_id IS NULL`, exactly one turn, non-streaming trace, variant-only or partial references, harness `codex` or `claude`. |

Provenance mechanics (from code, confirmed by data):

- The runner creates the session row for any run that arrives with a session id, via
  its alive-watchdog heartbeat (`services/runner/src/server.ts:465-482` →
  `api/oss/src/core/sessions/streams/service.py:569-577`), name NULL, creator NULL.
- The SDK **mints a fresh session id whenever an invoke arrives without one**
  (`sdks/python/agenta/sdk/models/shared.py:13-22`, applied in
  `sdks/python/agenta/sdk/middlewares/running/normalizer.py:282-283`). The `test_run`
  platform tool (`api/oss/src/core/tools/platform_handlers.py:132,208-213`),
  workflow-backed tool calls (`api/oss/src/apis/fastapi/tools/router.py:1438-1447`),
  and evaluation runs (`api/oss/src/core/evaluations/runtime/adapters.py:104,508`) all
  invoke without a session id, so **every such call creates a new orphan session row**.
- `run_kind` is not persisted on the session; it rides the request meta onto the trace.
  46 legacy traces (07-06 → 07-09) literally carry `meta: {run_kind: "test"}` with a
  variant-only reference and `stream=false`. These are directly observed `test_run`
  sessions.
  Modern traces no longer persist request meta, so for the 113 modern headless
  sessions the `test_run` attribution is **strongly inferred from the identical
  structural fingerprint, not directly observed**; direct API calls or QA-harness
  invocations that pass only a variant reference would look identical.

## 4. Findings by missing-title cause

The only title writers in the entire system are the browser auto-title effect
(`web/oss/src/components/AgentChatSlice/AgentConversation.tsx:172-177` →
`autoTitleSessionAtomFamily`, `state/sessions.ts:678-695`, introduced 2026-07-24 in
commit `b709c9d3dd`), the manual rename dialog, and the agent-facing `rename_session`
build-kit op (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:1556-1563`; used by
9 sessions ever, all titled). The backend `set_header` writes the client's payload
verbatim (`api/oss/src/core/sessions/streams/service.py:651-696`); no default, no
server-side titling, no LLM titling.

| Cause | Count | Evidence |
|---|---|---|
| No browser ever rendered the conversation | 7,836 (all) | Every untitled session is heartbeat- or trigger-created; zero streamed. The converse is proven by 5 cron-created sessions that a human opened in the UI ~14h after creation: the auto-title fired on load and wrote exactly 60 characters of the first prompt. 58 of 112 titles are exactly 60 chars (`AUTO_TITLE_MAX_CHARS`). |
| Session predates auto-title (2026-07-24) | 7,691 subset | Population A. These would still be untitled today for the same "no browser" reason, but they could not have been titled even if opened before 07-24. |
| First user turn had no text (image-only) | 0 observed | Every sampled untitled first message has non-empty text. The code path exists (`firstUserText` keeps only `type === "text"` parts) but contributes nothing to this population. |
| Title persistence failed (silent PUT failure) | 0 observed | The write is fire-and-forget with no retry, so this can happen, but no session shows the signature (local render without server name). |
| UI shows a session that should be filtered out | see §5 | The sessions page and home cards render rows they cannot open; the sidebar already filters them. |

## 5. Workflow-reference findings

References live only on `session_turns.references`, never on the stream row; the list
enriches each row with the **latest** turn's references at read time
(`api/oss/src/core/sessions/service.py:92-103,176-209`).

Title × reference-family cross-tabulation (each reference id resolved against
`workflow_artifacts` / `workflow_variants` / `workflow_revisions`; all 2,192 stored
elements resolve, none dangling):

| Title | Reference family on latest turn | Sessions |
|---|---|---|
| untitled | empty (no turn rows) | 7,696 |
| untitled | variant ONLY | 117 |
| untitled | artifact + revision (missing variant) | 22 |
| untitled | complete | **0** |
| titled | complete | 63 |
| titled | missing revision | 33 |
| titled | empty | 10 |
| titled | missing variant | 5 |

The `test_run` truncation hypothesis is **confirmed at both ends of the pipe**:

1. `test_run` forwards only `{workflow_variant: Reference(id=...)}` and asks the
   workflow service to pre-resolve the revision **into the request body**
   (`api/oss/src/core/tools/platform_handlers.py:208-213` →
   `_ensure_request_revision`, `api/oss/src/core/workflows/service.py:805-855`, which
   never writes the resolved references back onto `request.references`).
2. Because `data.revision` is now set, the SDK's reference hydration is skipped
   (`sdks/python/agenta/sdk/middlewares/running/resolver.py:594-609`), and
   `_merge_tracing_references`, the only step that adds the sibling `workflow` and
   `workflow_revision` references, never runs. The turn is written with the single
   bare variant reference.

Two aggravating storage defects:

- The runner stores `Object.values(...)` of the reference map
  (`services/runner/src/sessions/interactions.ts:59-63`), so the family keys are
  dropped; `session_turns.references` is a flat, untyped list of `{id, slug?, version?}`
  and nothing in the row says which element is the workflow versus the variant.
- Untitled sessions' references carry bare ids with no slug (0 of 161 elements);
  titled sessions carry slugs on 2,022 of 2,034. Headless writes are visibly a
  different, poorer serialization.

Environment references are never stored on sessions in either group (0 of 80 distinct
ids resolve to environment tables); they resolve to a revision inside
`_ensure_request_revision` and vanish. `workflow_revision` as a *keyed* trace reference
never appears; titled traces use the `application` / `application_variant` /
`application_revision` vocabulary while the dominant untitled shape uses
`workflow_variant` only.

**Effect on the UI (the "clicking brings you nowhere" symptom):**

- Visibility: `isStartedSession` shows a row if it has references OR a name OR a
  `last_message` OR a trigger (`sessionListPolicy.ts:35-45`).
- Openability: `SessionRow` requires `row.agentId`
  (`web/packages/agenta-sessions-ui/src/SessionRow.tsx:50`), which
  `sessionOpenTarget.ts:15` derives by taking the **first UUID in the references
  list**. No references → `agentId` null → the click handler's `if (vm.agentId)` guard
  (`web/oss/src/components/pages/sessions/SessionsPage.tsx:68-74`) silently swallows
  the click. Variant-only references → the "agent id" is actually a variant id → the
  app navigates to `/apps/<variant-id>/playground`, a dead route.
- The sidebar is the only surface that filters unopenable rows out
  (`web/oss/src/components/Sidebar/dynamic/sessionsSource.ts:66-78,166-167`); the
  sessions page and home cards render them inert with no message.
- Recovery is possible: all 6 variants behind the 117 variant-only sessions exist,
  are not soft-deleted, and carry `artifact_id` foreign keys to live workflows, so the
  missing family members can be reconstructed by FK walk.

Missing references also make sessions invisible to search: the list search is an
`ILIKE` on `name` only (`dao.py:289-343`), so untitled sessions can never match.

## 6. Representative evidence table

Full chain: UI row → stream record → turn → trace → origin → why untitled.

| Session | Created (UTC) | Creator | Origin evidence | Refs on turn | Why untitled / unclickable |
|---|---|---|---|---|---|
| `99e4dd161dba4dc2b8ef4413be786db5` | 08-12 14:40 | NULL (heartbeat) | harness `codex`, non-streaming, single turn; first msg 192 chars of text | variant only, no slug | No browser attached; variant-only ref makes the open target a variant id (dead route) |
| `091eba721ec249f190debce9e09e3bac` | 08-12 14:01 | NULL | harness `codex`, non-streaming; 904-char text first msg | variant only | Same as above |
| `2c9a2a9cd6da400e9c9aeacd59896dbb` | 08-12 14:08 | set | `ag.origin=trigger`, `ag.trigger.kind=schedule`; harness `claude`; turn `end_time` NULL | variant only | Scheduled run; no browser; turn never recorded completion |
| `d137f0a9dc7a480c9d9cfeb179bf31df` | 08-12 09:01 | NULL | daily 09:01 cron pattern of the legacy bulk project; 1 user + 3 agent messages in tracing | variant only | Headless cron; no browser |
| Legacy example: any of the 7,586 bulk-project rows, 07-06 → 07-13 | July | NULL | Predate turn tracking entirely; real conversations exist in `records` (398 sampled → 13,898 records, 710 user messages) | none (no turn rows) | Predate auto-title and turn tracking; no references → click is a silent no-op |
| Counter-example: 5 cron sessions titled "Run the daily GitHub measurement snapshot now. Work in the d" (60 chars) | 03:01 crons | NULL, later `updated_by_id` human | non-streaming trace, then a UI open ~14h later | complete after UI turn | Proves the mechanism: the moment a browser rendered the session, the auto-title wrote the first prompt |

Directly observed `test_run`: 46 root spans (07-06 → 07-09) carry
`meta: {run_kind: "test"}` plus a variant-only reference plus `stream=false`, the exact
fingerprint of shape D.

## 7. Unknowns and evidence gaps

- The 113 modern headless sessions match the `test_run` fingerprint structurally, but
  modern traces no longer persist request meta, so `run_kind` cannot be read for them.
  Attribution to `test_run` specifically (versus evaluations, workflow-backed tool
  calls, or external scripts invoking with a variant-only reference) is inferred, not
  observed. All members of that class are equally titled-never and reference-truncated,
  so the fix surface is the same regardless.
- The 22 untitled sessions with artifact+revision (missing variant) references are
  unexplained; they are non-streaming like the rest, but something other than the
  stream flag separates them from the variant-only 117.
- All 14,440 invocation root spans are named `_agent`, so the HTTP route is not
  recoverable from tracing; endpoint-level attribution relies on code reading.
- Counts drifted slightly during the session (streams 7,946 → 7,948) because live
  producers are still running; each table is internally consistent.
- Which exact surface the reported rows were seen on was not captured; "Untitled chat"
  wording implies the playground rail, while the unclickable behavior matches the
  sessions page and home cards.

## 8. Fix options

Ordered by leverage; several are independent. Written before any code was changed. Status
as landed: options 1 to 4 are IMPLEMENTED in this PR, option 5 was declined (no backfill),
and option 6 went to issue #5990. Where an option's wording differs from what shipped, the
implementation is authoritative: see [plan.md](plan.md) for the decisions (notably the
family discriminator is spelled `key`, not `kind`, and the option-4 filter applies to the
main list only) and [HANDOFF.md](HANDOFF.md) for the final state.

1. **Title at the source, server-side.** Write a default `name` when the first turn
   lands (the server sees the inputs) or at stream creation, e.g. first 60 chars of the
   first user text. Removes the browser dependency entirely; the browser auto-title
   becomes a no-op for already-named sessions. This is the only option that fixes
   headless, trigger, and future paths at once.
2. **Fix reference attribution on the headless path.** Make
   `_ensure_request_revision` write the resolved workflow + revision references back
   onto `request.references` (or have `test_run` forward the full family), so the
   skipped-hydration case still yields a complete set. Independently, stop dropping the
   family keys at the runner (`Object.values`) and store references keyed by kind so
   the frontend can pick the artifact id instead of "first UUID".
3. **Persist the workflow reference on the stream row at creation.** Today references
   ride only on a fire-and-forget turn append whose precondition fails open; the
   stream row itself could carry the artifact id from day one.
4. **Make visibility and openability agree.** Either filter unopenable rows on the
   sessions page and home cards the way the sidebar already does, or render them with
   an explicit disabled state. Any user-facing copy for the second variant is an owner
   decision.
5. **Backfill.** The 139 modern reference-truncated sessions are recoverable by FK
   walk (variant → artifact). The 7,691 legacy sessions have real conversations in
   `records` and could be batch-titled from their first user message, archived, or left
   as-is; that is a product decision.
6. **Put the session id in the URL.** Separate finding: the open flow passes the
   target session through client state only, so session links are not shareable and a
   refresh drops the selection.
