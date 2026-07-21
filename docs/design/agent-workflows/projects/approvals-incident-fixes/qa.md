# Live QA script

This script reproduces the shape of incident session db58551b on the dev stack and states
the correct behavior at every point. Run it after all five plan steps are deployed. The
run MUST produce a watchable MP4 screen recording (ffmpeg is available in `~/.local/bin`
on the dev box workflow), uploaded as a comment on PR #5382, and the recording is listed
first in the QA report.

## Setup

1. Deploy the branch stack to the local EE dev deployment (see the `debug-local-deployment`
   skill for the box, ports, and login; see the root `AGENTS.md` for the
   `load-env` + `run.sh --ee --dev` pairing). Confirm the runner container runs the
   `plan/concurrent-approvals` code and the API runs the `sessions-rebase/backend` code.
2. If step 1c's wipe has not been run yet, run it now (plan.md step 1c), before any QA
   turn, so turn indexes start clean.
3. Open the playground's agent chat with the Pi harness (`pi_core`), local sandbox, and a
   permission policy that gates `Bash` with `ask` (the default ask policy used in the
   incident).
4. Start the screen recording before the first prompt.

## Scenario A: two parallel gated writes (the incident shape)

Prompt:

> Append the line "hello from QA" to agent-files/README.md and to agent-files/NOTES.md,
> as two separate Bash commands issued in parallel in the same turn.

Walk through and check each point:

1. **First card appears.** The model issues two Bash calls; Pi serializes confirms, so one
   approval card appears first. Correct behavior: the second call shows as a pending tool
   part or a deferred sibling, and NOTHING shows a successful "(no output)" result for a
   command that has not run (defect 3). Open the Inspector's record timeline and confirm
   the second call has no success `tool_result` row.
2. **Approve card 1.** Correct behavior: the approved command executes, its REAL output
   (or a clean completed state) appears on the card, and the card stays in its approved
   or executed state permanently. It must never flip back to "waiting for approval"
   (defect 4/1), and it must never show the text "DEFERRED_NOT_EXECUTED" (defect 2).
3. **Second card appears** during or right after the first command's execution (it
   surfaces on the warm resume). Correct behavior: card 1's state is unaffected.
4. **Approve card 2 and do nothing else.** This is the click that died in the incident.
   Correct behavior: the approval dispatches on its own (watch the network tab for the
   message request; no extra text message is needed), the second command executes, and
   the assistant completes the turn.
5. **Verify the files.** In the session's workspace, each file contains the appended line
   EXACTLY once. Two lines in one file or a missing line fails the run.
6. **Verify the records.** In the Inspector: two `interaction_request` rows and two
   `interaction_response` rows (one per gate), and one truthful `tool_result` per call.
7. **Verify the turns.** On the dev database:
   `SELECT turn_index, harness_kind, created_at FROM session_turns WHERE session_id = '<id>' ORDER BY turn_index;`
   Indexes are 0, 1, 2, ... with no gaps and no duplicates, and the API access log shows
   no `POST /api/sessions/turns/ ... 500` lines for the session.

## Scenario B: rebuild while a gate is pending

1. Repeat the Scenario A prompt in a fresh session. Approve card 1, wait for card 2 to
   appear, then RELOAD the page before answering it.
2. Correct behavior after reload: card 1 renders as answered/executed (hydrated from its
   `interaction_response` record); card 2 renders as pending. No answered card is
   resurrected as waiting.
3. Approve card 2 after the reload. Correct behavior: the approval dispatches and the turn
   completes, exactly as without the reload. This was impossible before the fix (the
   all-settled condition could never hold after a rebuild).
4. Open the same session in a second browser window and confirm the same rendering.

## Scenario C: partial answers, one at a time

1. To get two cards genuinely outstanding at once, use the Claude harness (`claude`) with
   two ask-gated calls in one turn (Claude raises concurrent permission requests; Pi
   serializes them, issue #5391). Prompt for two parallel gated writes as in Scenario A.
2. Answer ONLY the first card. Correct behavior: the answer dispatches immediately, the
   first command executes and reports truthfully, and the second card remains pending
   (the session re-parks; it does not degrade to a cold restart and does not cancel the
   second gate).
3. Answer the second card. Correct behavior: the turn completes; both side effects exactly
   once.

## Known limitation to note in the report (not a gate)

Sending a NEW text message while a card is pending still routes down the approval-resume
or eviction path and can consume the message into the stale task (incident defect 6).
Real cancel-then-restart on new user text is explicitly out of scope here (see
context.md); note the observed behavior in the report rather than failing the run on it.

## Release-gate cells to re-run

After the scenarios pass, run the `agent-release-gate` skill against the same deployment
and re-run at least:

- the human-approval park and resume cells for `pi_core` on the local sandbox,
- the human-approval cells for `claude` on the local sandbox,
- the deny-path cell (a rejected gate renders as a decline, not an error),
- one full smoke cell per harness to catch regressions outside the approval path.

Attach the gate output to the PR comment along with the MP4.
