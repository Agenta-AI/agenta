# Release QA plan: `feat/sessions-storage-rework` (v0.106.x)

Date: 2026-07-28. Target stack: `agenta-ee-dev-sessions` on :8480, deployed from
`/home/mahmoud/code/agenta-106-2` in dev mode (source-mounted), env file
`hosting/docker-compose/ee/.env.ee.dev.sessions`. Session flags ON on that stack
(`AGENTA_SESSIONS_RECONSTRUCT`, `AGENTA_RECORDS_DURABLE`,
`NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY`); `AGENTA_RECORDS_SMART_TRUNCATION` is NOT set
on the API and must be enabled for the truncation tests.

## What the branch ships

Two risk classes:

**Always on (no flag) — this is what every customer gets on upgrade:**

1. Turns ledger replaces `session_states` (migration `oss000000017` drops the old table
   with no data migration; pre-upgrade sessions lose their resume pointer and go cold).
2. Server-backed session list: `POST /sessions/query`, archive/unarchive via
   `archived_at`, server-propagated delete, revive of killed sessions on resume, rename
   synced to the durable stream header, auto-naming from the first user message.
3. Concurrent-approvals hardening (parked gate map replaces the single latch) plus the
   batch UI (Approve all / Deny all with context peek) and "always allow this tool"
   grants written into the draft config.
4. Warm Stop (cooperative cancel; session resumable, sandbox destroyed) and Steer
   (deny + redirect, behind `NEXT_PUBLIC_AGENT_CHAT_STEER`).
5. Cold-replay transcript fixes: paused turn + resume fold into one message, pause
   sentinels render as nudges, behind-server snapshots cannot clobber a paused local tail.
6. Config drawer rework: changed-path highlighting with restore, dirty sections expand
   inline showing only changed controls, inline provider-key connect.

**Flag-gated, default off:** durable records, server-side history reconstruction,
last-message-only sends, smart truncation. The six fix PRs from the July 24 differential
QA (#5488–#5495) are merged.

Release mechanics: web production builds now fail on any TypeScript error
(`ignoreBuildErrors: false`), and the platform API calls the runner directly for kill,
so `AGENTA_RUNNER_TOKEN` must be set or compose fails.

## Division of labor

A colleague is re-running each sessions-train PR's fixed scenario against a live stack,
plus a wire-level pass (chat/approve/deny/warm/mount) and a regression sweep, with the
four flags on, and separately verifying they default off in source. This plan therefore
weights toward what that scope does not cover:

- Upgrade-in-place across the lossy migration.
- Flag-mismatch cells (web on / runner off loses all context on cold turns; runner on /
  web off still reconstructs on turn 1).
- The unflagged surfaces: session list REST + UI, batch approvals, always-allow grants,
  Stop, Steer, config drawer, cold-replay approval fidelity.
- Wire-level record assertions (ordering, truncation shape, silent drops) rather than
  scenario re-runs.
- Build mechanics (gh image build under the tsc gate; `AGENTA_RUNNER_TOKEN` coupling).
- The open case from July 24: duplicated tool_call id on a fresh turn after an approval
  resume.

## Phases

**Phase 0 — release mechanics.** Build gh images (tsc gate). DB-level upgrade test:
main's migrations + seeded `session_states`/streams rows on a scratch Postgres, then the
branch's migrations; assert clean run, then confirm a pre-existing session lists and
continues (cold) on the stack.

**Phase 1 — release gate, flags off.** Run `agent-release-gate` (cells C1 + C3 minimum)
with the three runner/web flags off, to regression-check the legacy path on branch code.

**Phase 2 — flags-on differential.** Same stack, flags on. Run the gate twice: once with
the stock full-history client, once with the driver's last-message-only mode, and diff
the message arrays the runner hands the model. Re-verify the four fixed defects (no
duplicated turn-1 prompt; warm session survives minimal history, log-grounded; oversized
records truncated, not dropped, with and without smart truncation; producer-time
ordering). Close the duplicated-tool_call-id case after an approval resume.

**Phase 3 — sessions REST surface.** Wire journeys against `/api/sessions/*`: query with
`include_ended`, archive → unarchive, rename via the header endpoint, hard delete
fan-out, revive on resume. Plus records queries asserting order and truncation shape.
Run the API acceptance suite (`api/oss/tests/pytest/acceptance/sessions/`).

**Phase 4 — UI QA, recorded.** MP4 for the PR: cross-device list sync, archive/rename/
delete from the rail, a multi-gate turn answered with Approve all, an always-allow grant
honored on the next call, Stop mid-turn then continue, Steer, paused-turn refresh (one
merged message, no duplicate cards), config drawer changed-path highlight + restore +
inline what-changed. Known-broken and excluded: mid-turn refresh sticks on a stale
transcript (issue #5530, assigned).

## Targeted edge cases

1. Delete/archive a session under ~60s old (not yet server-known): next poll must not
   resurrect it. (Known risk: local-only action.)
2. Reconcile treats absence as deletion; a session whose turn-reference join misses must
   not wipe the local transcript.
3. Two tabs on one session: a lock steal must not abort a healthy turn or tear down the
   sandbox (`is_current_turn: false` path).
4. Runner restart while parked on an approval: next turn must not 409/overwrite the turn
   row into an unresumable state.
5. Flag mismatch cells (both directions), and `AGENTA_RECORDS_DURABLE=1` being a silent
   no-op (runner accepts only the literal string `true`).
6. Always-allow: non-matching grant fails silently; rule must match the tool name
   verbatim; Undo pins `permission: "ask"` leaving a phantom draft diff.
7. Reused toolCallId across turns folds into the old bubble and the approval dock (which
   scans only the last message) shows nothing: run parks with no visible gate.
8. A real tool output beginning with a pause-sentinel string renders as a nudge.
9. Rename on a killed session: API returns 200 and silently does nothing; reachable from
   the UI since ended sessions are listed.
10. Records query 403 (credential without VIEW_SESSIONS) silently degrades a cold turn to
    one-message context.

## Flags

| Flag | Layer | Default | Parsing |
|---|---|---|---|
| `AGENTA_RECORDS_DURABLE` | runner | off | strict `"true"` only |
| `AGENTA_SESSIONS_RECONSTRUCT` | runner | off | strict `"true"` only |
| `NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY` | web | off | must pair with runner reconstruct |
| `AGENTA_RECORDS_SMART_TRUNCATION` | API | off | broader truthy set |
| `NEXT_PUBLIC_AGENT_CHAT_STEER` | web | off | gates Redirect button |
| `NEXT_PUBLIC_AGENT_CHAT_STOP_KILLS_SESSION` | web | off | restores hard-kill Stop |

## Execution log

Filled in as runs complete; per-run results land under the gate's runs directory and are
summarized here.

| Phase | Status | Notes |
|---|---|---|
| 0 gh build | pending | |
| 0 migration | PASS | 2026-07-28, scratch Postgres 16. Main's chain, seeded session
  data, then the branch chain: clean run, no constraint failures; `016` backfill
  extracts `agent_id` correctly; `017` downgrade/re-upgrade round-trips. Confirmed
  loss is limited to resume pointers (`session_states` held only continuity fields on
  main; names were never stored there), so pre-upgrade sessions resume cold but keep
  their history. Caveat: `016`'s table-wide mounts UPDATE is untested at production
  scale. Reusable migration command recorded in the job log. |
| 1 flags-off gate | PASS | 2026-07-28, C1/haiku, three session flags off (legacy
  path): 11/11 journeys PASS; records still ingest via the fire-and-forget path; the
  only runner-log `mismatch` was the expected config-fingerprint eviction after the
  commit journey bumps the revision. |
| 1b truncation shapes | PASS | Direct ingest of a 100KB tool_result (harnesses
  pre-clip bash output at 30-50KB, so the bash route can never reach the 64KB cap):
  flag off → record persisted with the bare `{"_truncated": true}` placeholder (never
  absent, the #5491 check); flag on → structure preserved, trimmed field marked, with
  `_truncated: {fields, original_bytes}`. |
| 1c mismatch hazard | NARROWED | Client minimal-history with reconstruction off did
  NOT silently lose context on this stack: the harness's always-on native session
  continuity (session/load from the durable mount) restored context across warm-pool
  eviction on both Claude and Pi. The only forced break (runner replica change, local
  sandbox) fails loudly: "Refusing to cold-start on the wrong host." Residual risk is
  multi-replica / Daytona routing, untested here. |
| 2 differential, leg 1 | PASS | 2026-07-28, cell C1 (claude/local/subscription, haiku),
  flags on, full-history client: 10/10 journeys PASS including the new `records` and
  `sessions` journeys. Runner log: warm reuse confirmed on multi-turn journeys
  (`hit-continue`/`resume`), no `DROPPED`/`degraded`/`skipped` hits; the only `cold`
  lines are legitimate first turns. |
| 2 differential, leg 2 | PASS | 2026-07-28, C1/haiku, flags on, `--last-message-only`:
  chat, warm, and the new `followup` journey all PASS. `sent_messages` dumps prove
  plain turns send exactly one message while approval resumes keep full history,
  matching `agentRequest.ts`. The open July 24 case (duplicated tool_call record after
  an approval resume) did NOT reproduce, in either client mode. Note for future runs:
  Claude reuses the same wire toolCallId when a paused call settles post-resume; that
  is expected, not a defect. |
| 3 acceptance suite | PASS | 2026-07-28, 177/177 against the live stack (:8480):
  archive/unarchive, records ingest contract, stream headers, DAO unit+integration. |
| 3 REST surface | pending | |
| 4 UI recording | pending | |
