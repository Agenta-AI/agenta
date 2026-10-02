# Wallets: plan caps on agent turns, and the limit messages

A turn is never stopped for its balance. A turn admitted just before the balance reaches zero
runs to its end, so the balance can go below zero. Two caps per plan limit how far: how many
turns an organization runs at once, and how long one turn runs. This page also covers billing
sandbox time only while a turn runs, and the messages a person reads when a turn meets a limit.
It is release plan steps 1.5 and 1.6.

## Decisions

Decided by the owner on 2026-10-02.

| Plan | Turns at once | Longest turn |
| --- | --- | --- |
| Hobby (free) | 2 | 30 minutes |
| Pro | 10 | 4 hours |
| Business | 25 | 11 hours |

1. **A turn over the cap is refused, not queued.** The person reads a message and sends again
   later.
2. **A turn at its time limit is stopped.** What it did so far is kept, and the person continues
   in a new message.
3. **Sandbox time is billed only while a turn runs.** The warm window after a turn and a turn
   waiting for a person's approval are not charged, although the sandbox keeps running on the
   platform's provider account.
4. **The wording of the three messages is a draft pending approval.**

## Where the numbers live

`api/ee/src/core/access/entitlements/types.py` holds one named constant per plan
(`HOBBY_AGENT_TURN_CAPS`, `PRO_AGENT_TURN_CAPS`, `BUSINESS_AGENT_TURN_CAPS`) and the map
`AGENT_TURN_CAPS` from plan slug to caps, next to the plan entitlements.

They are not a new entitlement tracker. The trackers are meter-backed quotas (flags, counters,
gauges, throttles) with an env override parser. A count of running turns is a live value held
in Redis, and a turn length is not a quota. A tracker would have needed a meter and parser
changes for no benefit. A plan not in the map (the internal plan, self-hosted, a custom plan)
has no caps: the runner keeps its own deadline.

## When the caps apply

Only to turns on the platform's own sandboxes (`daytona` and `inprocess`), the turns the runner
already asks the API to admit. Only while the organization's wallet is on: `wallets-rollout` is
`shadow` or `enforce` (the same rule as measurement). An organization whose mode is `off`, and
every self-hosted or OSS deployment (the wallet flag is off, so the admit route is a 404), runs
uncapped with the runner's env deadline.

In `shadow` mode the caps are enforced, while the credit check only logs. The caps protect the
platform's sandbox quota and bound overshoot; they are not a charge.

## How it works

```text
runner --admit {turn_id}--> API /wallets/sandboxes/admit
         <-- {allowed, code, message, turn_limit {seconds, message}, slot_held}
runner --heartbeat every 60 s--> /wallets/sandboxes/turns/heartbeat {turn_id}
runner --release at turn end--> /wallets/sandboxes/turns/release {turn_id}
```

All three routes take the runner token and the run's own credential, like the usage route.

### Admission

1. Mode `off`: admitted, no caps, no turn limit.
2. The plan is read through the entitlements subscription cache (`plan_for`). A plan that
   cannot be read admits uncapped.
3. The credit check runs first. A refusal answers `wallet_balance_exhausted` with the
   out-of-credit message for the plan. No slot is taken.
4. The plan's caps: the turn takes a slot in the organization's running turns. At the cap the
   answer is `concurrent_turns_limit` with the concurrency message.
5. Admitted: the answer carries the plan's turn limit and its message, and `slot_held`.

A slot store that cannot answer admits the turn uncounted. A metering outage must not stop
agents, the same rule as the rest of admission.

### Running turns

One Redis sorted set per organization on the volatile Redis, `wallets:turns:{organization_id}`.
Each member is a turn id, scored by when its hold expires (Redis server time). Admission runs
one Lua script: drop expired holds, keep a turn that already holds a slot, refuse at the
limit, otherwise add. A hold lasts 180 seconds. The runner beats every 60 seconds, and a
beat takes the slot back even after it expired, because a running turn is never stopped by
the count. The runner releases the slot when the turn ends, however it ends, including a pause
for a person's approval. A runner that dies stops beating, and its turns leave the count
within three minutes.

The same turn id asking again (a retried dispatch) keeps its own slot.

### Turn length

The runner already had a total deadline per turn (`run-limits.ts`, 11 hours by default,
`AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS`). The API states the plan's limit per turn in the
admission answer, which is the simplest place: the runner asks before every turn anyway.
The runner uses the smaller of the plan's limit and its env deadline, so an operator's lower
deadline still wins, and a deployment without the wallet keeps its env value. When the plan's
limit is the one that fires, the turn ends with the code `turn_time_limit_reached` and the
API's message. A pause for a person's approval stops every deadline, as before.

### Billing only while a turn runs

The sandbox meter (`services/runner/src/metering/sandbox-usage.ts`) keeps its per-minute
reports. Each meter of a session's sandbox now runs only while a turn of that session runs:
`beginMeteredTurn(sessionId)` at admission resumes it, and the end of the turn pauses it. A
pause cuts the open interval at the turn's end and reports it like any interval. A sandbox
that comes up between turns starts paused. A run without a session has no warm window, so its
meter runs until its sandbox stops.

## The messages

The API writes each message (`api/ee/src/core/wallets/caps.py`), because it knows the plan and
its numbers. Each one names the limit, the plan's number, what happened to the work, and what
to do next. Each is one line, because the SDK keeps only the first line of a runner error.

The chat (`web/mobile`) maps the code to a title and shows the message whole. Where billing is
on, it adds a "Plans and billing" button. It never shows a raw code.

| Code | Chat title |
| --- | --- |
| `wallet_balance_exhausted` | Out of credits |
| `concurrent_turns_limit` | Too many agents running |
| `turn_time_limit_reached` | Turn time limit reached |

Draft wording, pending approval:

- **Too many agents at once.** "Your organization already has 2 agents running, the most the
  Hobby plan allows at once. This turn did not start, and you were not charged. Your running
  agents keep working. Send your message again when one finishes, or upgrade to Pro to run 10
  at once." Pro ends "upgrade to Business to run 25 at once."; Business ends "contact us to
  raise the limit."
- **Turn too long.** "This turn stopped after 30 minutes, the longest turn the Hobby plan
  allows. Files the agent saved in its workspace are kept, and you were charged only for the
  time it ran. Send a new message to continue from where it stopped, or upgrade to Pro for
  turns up to 4 hours." Pro ends "upgrade to Business for turns up to 11 hours."; Business ends
  "split the work into smaller turns, or contact us."
- **Out of credit.** "Your organization has used all its credits, so this turn did not start,
  and you were not charged. Turns already running will finish. Agents that use your own model
  key still need credits for sandbox time." Then, by plan: Hobby "Your free daily credits come
  back at 00:00 UTC, or upgrade to Pro for 2,900 credits a month."; Pro "Buy credits from $10
  for 1,000 credits, or upgrade to Business for 29,900 credits a month."; Business "Buy credits
  from $10 for 1,000 credits, or contact us."

The plan names come from the plan catalog, so the free plan reads "Hobby", the name the billing
page shows.

### Managed tools during an outage

A managed tool call whose wallet check cannot answer (an error or a timeout) is still refused,
but with the code `billing_unavailable`: "Billing is unavailable right now, so this tool call
did not run. You were not charged." It is retryable. Before, it read as "Your Agenta credits do
not cover this tool call", which told the agent to ask the user for credits during an outage.

## The credits view

For an organization whose wallet is enforced (`GET /wallets/summary` now states the mode):

- The sidebar meter shows credits left of the active credits' total, in credits (1 credit =
  1 cent), and opens the Credits tab.
- Settings, Credits: credits left, each active credit with what is left and when it expires,
  and credits used per day for 30 days by category. The usage detail needs the owner's
  permission; a member sees a line saying so.
- The raw Usage (debug) tab is shown only in development builds.

## Known gaps

- A model call refused mid-turn by the gateway's credit check (the balance reached zero during
  the turn) still reads as a gateway refusal, not as the out-of-credit message. Admission
  refuses first in practice, because it runs the same check before the turn.
- The out-of-credit message for Hobby names the daily free credits (decided, built by release
  plan step 1.3). It must not ship without them.
- Turn ids are runner-minted lock values. A runner token holder could hold slots for an
  organization whose credential it also holds, the same trust root as the usage report.
