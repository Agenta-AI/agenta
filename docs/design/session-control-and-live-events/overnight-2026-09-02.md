# Overnight protocol, 2026-09-02 to 2026-09-03

> AGENT-GENERATED. This is the log of what an unattended agent session did overnight on the
> session-control RFC. Mahmoud reviews it in the morning and reverts anything he does not want.
> Every change sits on its own branch. Nothing was merged. Nothing was pushed to `main` or to a
> release branch.

## How to read this file

1. "What you asked for" restates the task in one paragraph.
2. "Where everything is" lists every branch, worktree, stack, and file, so you can revert one
   piece without touching the others.
3. "Timeline" records each step in order, with the time and the outcome.
4. "Results" summarizes each work package: what was found, what was built, what was verified
   live, and what was not done.
5. "Decisions I made for you" lists every judgment call, with the reason, so you can overturn
   it.
6. "Morning checklist" is the shortest path to a review.

## What you asked for

Read the RFC on `agent/session-execution-rfc`, review it with subagents and write the review,
run the plan-feature process, split the work into independent parts, start the spikes with
Opus subagents, read the earlier research from today, focus on the open issues, and record
everything so the morning review can correct or revert. The RFC is the agreed direction; the
"Fixed direction" list in `tonight-handoff.md` was treated as settled.

## Where everything is

| Item | Location | Base | Purpose |
|---|---|---|---|
| RFC branch (unchanged) | `agent/session-execution-rfc` at `f4a6834ba6` | `main` at `33b442f41e` | The agreed RFC. Not modified tonight. |
| Overnight docs branch | `agent/session-execution-overnight`, worktree `~/code/agenta-2-worktrees/session-overnight` | RFC tip | Reviews, plan updates, this protocol. Docs only. |
| Spike A branch | `spike/session-cancel-warm`, worktree `~/code/agenta-2-worktrees/spike-a-cancel` | RFC tip | Sandbox cancel that keeps the sandbox warm. Runner code plus a doc. |
| Spike B branch | `spike/session-durable-commands-design`, worktree `~/code/agenta-2-worktrees/spike-b-commands` | RFC tip | Durable command and long-poll design. Docs only. |
| Spike C branch | `spike/session-stop-map`, worktree `~/code/agenta-2-worktrees/spike-c-stop-map` | RFC tip | Map of the current Stop path. Docs only. |
| Spike D branch | `spike/session-record-id-semantics`, worktree `~/code/agenta-2-worktrees/spike-d-record-ids` | RFC tip | Stable record-id inventory plus characterization tests. |
| Shared agent brief | `/tmp/claude-1000/-home-mahmoud-code-agenta-2/7c724667-82cd-41a6-ba0b-e47bc96b4f67/scratchpad/COMMON-BRIEF.md` | | The rules every subagent received. |
| Live test stack (if Spike A got that far) | project `agenta-ee-dev-session-spike`, port 8580, Postgres 5440 | Spike A worktree | Teardown: `cd ~/code/agenta-2-worktrees/spike-a-cancel && bash ./hosting/docker-compose/run.sh --license ee --dev --env-file .env.ee.dev.spike --down --nuke` |

The main workspace `/home/mahmoud/code/agenta-2` was not edited. The toolkit stack on port
8780 and the team stack on port 8290 were not touched.

## Timeline

| Time (Europe/Berlin) | Step | Outcome |
|---|---|---|
| 22:05 | Read the RFC folder (ten files), the research brief from this morning, and the evidence folder. | Done. |
| 22:20 | Created five worktrees from the RFC tip. | Done. |
| 22:25 | Started six Opus subagents in parallel: two reviewers and four spikes. | Running. |
| 22:33 | Product and scope review returned. Filed as `review-product-2026-09-02.md`. | All 48 listed issues are open. Version one as written in the handoff closes one issue fully and eight partly. The double send needs no new table. The park rule change is missing from the version-one steps. |
| 22:36 | Started two implementation slices in their own worktrees, because they do not depend on the spikes and touch different files: single-turn admission (branch `feat/session-single-turn-admission`, stack port 8680) and the execution watchdog (branch `feat/session-execution-watchdog`, stack port 8880). | Running. |
| 22:40 | Architecture review returned. Filed as `review-architecture-2026-09-02.md`. | Verdict: not ready as written. Four blocking holes: Stop destroys the sandbox (park rule), Stop cannot reach a parked approval (heartbeat stops), a late Stop kills the next turn (no stale guard), and a claimed command has no settlement owner when the runner dies. Both reviews agree on the park rule and the watchdog. |
| 22:42 | Sent the holes to the running spike agents: Spike B gets the command-loop lifetime, duplicate delivery, and settlement rules; Spike A gets the abort-versus-Stop distinction and the parked window question; the watchdog slice gets the note that the Redis lease TTL is 3600 s, so it must key off heartbeat age. | Sent. |
| 22:43 | Started a third slice, the Stop guard (branch `feat/session-stop-guard`, stack port 8980): the desktop sends the turn id it expects on Stop, the API refuses to supersede a turn that started after the Stop was created, and Stop cancels pending interactions. | Running. |
