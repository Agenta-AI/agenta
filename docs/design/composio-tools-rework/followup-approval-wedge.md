# Follow-up issue draft: a cold replay leaves an unanswerable approval card

**Status:** draft, for filing outside the gateway-connection rework. Found during the live QA
of that rework on 2026-08-27, confirmed to be **pre-existing platform behavior** and NOT caused
by it.

## Title

Playground: after a cold replay, a pending approval card stays on screen but can no longer be
answered

## What happens

A turn parks on an approval. The session then cold-replays, which happens whenever the stream
reconnects — the web container restarting, and plausibly any long connection drop. The runner
issues `cancel-stale` for the session, and the pending `session_interactions` row moves to
`cancelled`.

The playground keeps rendering that approval as a live card. Approve, Deny and Dismiss are all
enabled and none of them does anything. The tool never runs and the card never clears. A full
page reload does not clear it. The session is unusable until the user switches to another one.

## Why it is not the gateway rework

Reproduced with a **built-in** `write` approval, which the rework does not touch:

| | |
| --- | --- |
| Row | `01a0411b-2518-7871-9f89-d82f2cc797eb`, kind `user_approval` |
| Created | 2026-08-27 02:44:53 UTC, pending |
| Left pending | 13 minutes, untouched — it is NOT a timer |
| Cold replay | `docker restart agenta-ee-dev-toolkit-web-1`, then reload |
| Row after | `cancelled` at 02:57:32 UTC |
| Card after | still rendered, Approve/Deny/Dismiss all enabled |
| Approve clicked | no effect after 90 s, card never cleared |
| Side effect | `d4-probe.txt` never written |

The same sequence on a gateway `run_tool` approval behaves identically, so the wedge is shared,
not gateway-specific.

## What is correct here, and should not be "fixed"

The sweep itself is intended. [qa.md](qa.md) case R21 requires that an unanswered approval is
swept to `cancelled` rather than left `pending`. The bug is only that the UI does not follow the
row into its terminal state.

It is also not a five-minute timeout. An early reading of this as a timer came from coincidence:
two gateway approvals were cancelled about five minutes after creation, but both times a cold
replay happened to occur in that window. A built-in approval sat pending for 13 minutes with no
sweep at all.

## Suspected owner

The approval dock and the card's pending-set derivation, most likely
`web/packages/agenta-chat/src/model/approvals.ts` (`getPendingApprovals`) and
`web/packages/agenta-chat/src/hooks/useApprovalDock.ts`. `getPendingApprovals` reads the tool
part's state from the transcript and never consults the interaction row's status, so a row that
moved to `cancelled` server-side still yields a card. A cancelled or otherwise terminal
interaction should drop out of the pending set and render as a settled transcript row.

Worth checking in the same pass: a swept row currently renders in the transcript as "denied",
which is a different outcome from "cancelled" and misreports what happened.

## Repro

1. Ask an agent to write a file, so a built-in approval parks.
2. Leave it unanswered. Confirm the row is `pending` and stays that way.
3. `docker restart <web container>`, wait for the app, reload the playground.
4. Click Approve on the card that is still displayed.
5. The card does not clear, the file is not written, and the row reads `cancelled`.
