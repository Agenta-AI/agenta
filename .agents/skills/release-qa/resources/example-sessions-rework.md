# Worked example: sessions-storage-rework release QA (v0.106, 2026-07-28)

A sanitized snapshot of a real run of this skill, kept as the reference example.
Machine-specific values are replaced with placeholders. The live execution log for that
release stayed in the repo's QA docs; this copy is frozen for teaching.

## What the branch shipped

**Always on (no flag):**
1. A turns ledger replaced the mutable `session_states` blob; the old table is dropped
   by a lossy migration, so pre-upgrade sessions lose resume pointers and go cold once.
2. Server-backed session list: query, archive/unarchive, propagated delete, revive on
   resume, rename synced to a durable header, auto-naming from the first message.
3. Concurrent-approvals hardening plus batch UI (Approve all / Deny all) and
   always-allow grants written into the draft config.
4. Warm Stop (cooperative cancel) and Steer (deny an approval with a redirect).
5. Cold-replay transcript fixes (paused turn + resume fold into one message).
6. Config drawer rework (changed-path highlighting, inline what-changed).

**Flag-gated, default off:** durable records, server-side history reconstruction,
last-message-only sends, smart truncation. Four flags across three layers with
different truthiness parsing (two runner flags accept only the literal `"true"`).

Release mechanics: web production builds newly fail on any type error; the API gained a
hard dependency on a runner token env var.

## Division of labor

A teammate re-ran each sessions-train PR's fixed scenario plus a wire pass and a
regression sweep, flags on. This plan therefore weighted toward: the always-on
surfaces, the upgrade migration, flag-mismatch cells, wire-level record assertions,
build mechanics, and one open defect prediction from an earlier review.

## How the phases landed (execution log summary)

| Phase | Verdict | What it proved |
|---|---|---|
| Migration upgrade | PASS | Main's schema + seeded data migrated cleanly; destructive drop round-trips on downgrade. A suspected "name loss" finding was retracted after checking what main actually wrote to the dropped table — synthetic seeds can invent losses that cannot occur. |
| Wire gate, flags off | PASS | 11/11 journeys on the default customer path; the only log `mismatch` was the expected config eviction after the commit journey. |
| Wire gate, flags on, full history | PASS | 10/10 including records readback and sessions REST lifecycle; warm reuse proven from the runner log, not latency. |
| Differential leg (last-message-only) | PASS | Per-turn sent-message dumps proved plain turns shrink to one message while approval resumes keep full history. The open defect prediction (duplicated tool-call record after approval resume) did not reproduce; learned that the harness legitimately reuses a wire toolCallId when a paused call settles. |
| Truncation shapes | PASS | Direct ingest of an oversized record (harnesses pre-clip tool output, so the natural route can never reach the cap): flag off gives a surviving placeholder record; flag on preserves structure with truncation metadata. |
| Flag-mismatch cell | NARROWED | The predicted "silent total context loss" did not occur: native harness continuity (independent of the reconstruct flag) restored context across warm eviction; the only forced break failed loudly. Residual risk confined to multi-replica routing, explicitly recorded as untested. |
| Acceptance suite | PASS | 177/177 against the live stack. |
| Two-writer race | FINDINGS | Concurrent turns are not gated at start (parallel sandboxes per session); the loser is reaped only at its next 30s heartbeat; the turn right after a takeover can land on a pool entry mid-teardown and fail user-visibly with no retry. Two issues filed (one bug, one design characterization). Record log stayed consistent throughout — worth stating explicitly. |
| Depth probes + recorded browser pass | run per the skill's phase list |

## Transferable lessons this run generated

1. The differential method finds what verdicts cannot: both legs passed everything;
   the evidence value was in the diffs and logs.
2. Characterization beats prediction: two "certain" hazards from code analysis (context
   loss, name loss) both dissolved under live probing, while an unpredicted race became
   the sharpest bug of the day.
3. Check who else is testing before planning; half the branch was already covered.
4. Serial stack mutations with byte-identical env restoration made five flag states
   testable on one shared stack without breaking anyone.
5. QA logins in the developer's real browser kill their other sessions (cookies are
   host-scoped, not port-scoped): isolated browser profile, always.
