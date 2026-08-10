# Why this work exists

## What the user experiences today

Mahmoud drove one conversation on the release stack (sessions 6609cd91 and e627d80a,
2026-08-10): create an agent that sends Arabic poetry to Telegram every morning. The agent
asks a questionnaire, then asks to connect Telegram, then asks to approve a schedule. Every
step that should show exactly one card showed the wrong set:

1. The "running somewhere else" strip appeared in the tab that was itself driving the run.
2. When the connect card appeared, the already-answered questionnaire reappeared with it,
   blank and interactive, and the answer he had given was ignored.
3. After connecting successfully, he had to scroll back and answer the questionnaire again.
4. At the schedule step, the connect card came back (dead: no click worked, not even
   "Not now"), the strip flashed again, and the original questionnaire showed again.
5. In a later run where the connection fully succeeded, the agent asked him to connect
   Telegram again as if nothing had happened.

His summary, which this project adopts as the thesis: whenever there is one new thing to
show, the UI shows everything instead of that thing.

## Why it keeps happening

Fixes so far treated each symptom where it surfaced: the strip's derivation, one replay
branch, one adoption race, one scheme default. Each fix was real, verified, and correct,
and the class keeps returning because the underlying model is fragmented. Interaction
state lives in four places that do not agree on ownership or lifecycle:

- the live stream's in-memory messages (what this tab saw happen),
- the persisted transcript records (what the server remembers being said),
- the `session_interactions` rows (what the server considers pending or settled),
- the localStorage message cache (what this tab saved last time it settled).

Different render paths read different subsets of these, at different moments, with
different staleness, and several server-side transitions (cancellation sweeps, the
one-interaction-per-turn rule, TTL expiry) happen with no signal to the client at all.
The model, meanwhile, sometimes never learns the outcome of an interaction it requested,
so it asks again even when the thing it asked for succeeded.

## Goal

One documented, enforced lifecycle for client-tool interactions: a single answer to "what
may render right now, in what state, from which source of truth", and a guaranteed path
for interaction outcomes to reach both the UI and the model. The plan in this workspace
sequences the changes that get there, building on today's landed fixes rather than
replacing them.

## Non-goals

- Redesigning the approval-gate UX or the widgets' visual design.
- The connection-reuse product feature (tracked as issue #5911); this project only
  guarantees the model learns outcomes, which #5911 then builds on.
- The runner's approval-ordering race (PR #5910) and its suppressed-carried-gate
  follow-up; they are adjacent, tracked, and referenced, not re-planned here.
