# Build notes — overnight run 2026-06-30 → 07-01

Judgment calls made autonomously while Mahmoud was asleep, with the reasoning, so they can be
reviewed in the morning. The full record is in the lab at `agent-creation-lab/` (`report.md`,
`verified-facts.md`, `experiments/*/result.md`).

## Decisions

1. **Reframed the deliverable to one general kit.** Mahmoud's goal this round: "find a
   configuration that, given to an agent, lets it solve all the problems." So instead of a
   separate instruction file per case (night 1's shape), the deliverable is one playbook
   (`kit/BUILD-AGENT.md`) + shared scripts (`kit/scripts/`). This is also what ports back into
   `agenta_builtins.py` / `op_catalog.py`, which are general.

2. **Floor-first method.** For each case I solved it myself directly against the live API before
   spending a subagent — to find the real floor (calls/seconds), to de-risk ("if I can't, the
   subagent can't"), and to keep each subagent run short and scrutable. Then a fresh Sonnet
   subagent runs the kit and I verify its claims independently (trace + spans).

3. **Added the capstone (case 9): the original GitHub→Slack digest.** Mahmoud asked for "another
   example that requires connections." I used the exact worked example that started this project
   (twice-daily repo digest to Slack) because it is the case he saw the live agent fumble and it
   exercises both connections + a schedule + a style at once. It is the real prize.

4. **Case 6 missing-connection target = Notion.** GitHub and Slack are connected; Notion and
   Telegram are not. Notion is the cleanest "needs_auth → stop and ask" target.

5. **Case 8 (Telegram) is not completable on this deployment — and that's the honest answer.**
   Telegram is a known integration but not connected, and `find_triggers` has no real "new
   telegram message" event (it mis-matches to a Slack event). So the correct agent behavior is to
   discover, detect `needs_auth`, explain the one-time BotFather + connect step the human must do,
   and stop. I did not fake a working Telegram bot. (Per Mahmoud: if I can't solve the hardest one,
   the subagent can't either — so the kit teaches the honest stop.)

6. **Case 3 (trace annotation) exposes a gap.** The annotations endpoint works, but there is no
   agent-callable `annotate_trace` op, so a self-reflecting agent can't annotate its own trace
   today. Documented as a porting recommendation; did not hack a fake tool.

7. **Posted real test messages to Slack.** Mahmoud connected Slack specifically for this, so the
   capstone test actually posts a digest (verified `ok:true`). A couple of test messages landed in
   a casual channel (the agent chose one like `#social`/`#random`). Flagging so they're not a
   surprise.

8. **No literal mid-flight interruption (tooling limit, stated honestly).** Subagents run to
   completion and return a final report; the harness doesn't expose a sub-minute interrupt. I got
   the same safety a different way: pre-solve each case, hand the subagent the exact path, and
   require a short bullet report — so runs finish in under a minute or two and a bad path shows up
   in the report, not after ten minutes. Where a report showed friction (case 2's missing skill
   schema), I fixed the kit and re-ran.

9. **No backend/SDK changes.** `op_catalog.py` / `agenta_builtins.py` untouched, per the standing
   constraint. Everything is lab scripts + the playbook. The porting recommendations are written
   down for when Mahmoud wants them.

## Live resources created (cleanup plan)

Throwaway floor apps I made directly (archive at end): `github-floor`, `style-floor`,
`capstone-digest`. Subagent apps kept as the experiment record (one per case): `uc1-summarizer`,
`uc4-github-username`, `uc2-style-editor-v2`, `uc9-digest`. The case-6 run correctly created
nothing. A test schedule was created and removed. One probe annotation auto-created an evaluator
(minor, not easily deletable). `round-1-summarizer` and `round-1-summarizer-attempt-2` remain from
night 1.
