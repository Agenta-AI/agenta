# Research: how cards really behave today

Words like "row", "sweep", "replay" are defined in [README.md](README.md). Every claim
here was proven on 2026-08-10 with database rows, logs, or git history. Exact file and
line references live in the two inventory reports and the PR discussion; this file
keeps the findings readable.

## Finding 1: the system never records that the user answered a card

This is the root of everything, so read it slowly.

When the user answers a form card or completes a connect card, the answer goes to the
agent, and the agent continues. Good. But the interaction ROW is never updated. It
stays `pending`. Then the next turn starts, the sweep runs, and the sweep closes every
old `pending` row as `cancelled`.

So in the database, form and connect rows never carry the answer. An answered form and an
abandoned form both end `cancelled`, with nothing attached, so nothing can tell them
apart. An untouched connect card stays `pending` instead. This has been true since these
cards were built. We checked every row from the whole day:

| Card kind | User completes it | User declines it | User walks away |
|---|---|---|---|
| Approval card | `resolved` + verdict saved | `resolved` + verdict saved | `pending`, later swept |
| Form card | `cancelled`, nothing saved | `cancelled`, nothing saved | `pending`, later swept |
| Connect card | `cancelled`, nothing saved | `pending`, never touched | `pending`, never touched |

Read the table like this: only the approval card does it right. It has a real
"answered" state and it saves the verdict. Form and connect cards funnel every outcome
into the same meaningless end state.

Why it matters: any screen that reads the row cannot tell "answered" from "abandoned".
So it shows the wrong thing, forever, for every answered card.

## Finding 2: how each bug Mahmoud saw follows from this

**Cards come back after you answer them.** After a reload, the browser rebuilds the
chat from the server (replay). The replay looks at the interaction rows. The rows say
`cancelled` for everything (Finding 1). So an answered form replays as "Dismissed". A
working connection replays as "Connection not completed" with a Retry button. And when
the row lookup is slow or empty, the same card replays as a live, clickable form. What
you see after a reload depends on a cache. That is why it felt random.

**Your answer gets lost.** When you answer a card, the browser waits a moment before it
sends the resume. In that moment, a background refresh can arrive and adopt the
server's older copy of the chat. Your answer is thrown away before it was sent. We
reproduced this with network logs: zero requests left the browser. (Fixed in #5909;
the fix also re-checks at the exact moment of adoption.)

**A dead card blocks the screen.** The connect card's buttons do not live on the card.
They live in a dock at the bottom of the chat, and the dock only looks at the LAST
message. When a new turn starts, the parked card is no longer in the last message. The
dock disappears. The card in the chat says "waiting for your response below", and below
there is nothing. That is the unclickable card.

**The strip accuses your own tab.** The tab's status only counted a waiting card if it
was in the last message. A new turn starts, the card is no longer last, the tab thinks
it is idle, the server says the session is running, and the strip concludes: someone
else runs this. (Fixed in #5913: the tab now scans the whole chat.)

**The agent asks to connect again after a success.** The agent does not learn outcomes
from the rows either. It learns them from the conversation itself, or by re-reading
the live config. That side channel usually works. It can also lie: in one session the
agent said "Telegram is connected" while the only connection on file was expired, and
then it built a schedule on top of it.

## Finding 3: when each piece was born (checked against version 0.108)

Mahmoud reported that cards worked fine on version 0.108. We checked git history
against that claim. The result surprised us:

- The root defect (Finding 1) is NOT a regression. It shipped complete in version
  0.105.0. The delivery code is byte-identical between 0.108.1 and today. A resolve
  call never existed in the form and connect delivery code (approval cards always had
  one, see Finding 1). Nothing was lost; it was never written.
- Version 0.108 looked correct for one reason: nothing read the broken rows. Replay
  ignored them and rebuilt cards from the conversation records, which DO carry the
  answers. The lie existed, but no screen displayed it.
- Two later changes made the lie visible. Version 0.111 added a live refresh channel,
  so adoption can now happen in the middle of a turn (that enabled the lost-answer
  bug). And on 2026-08-10, PR #5859 made replay read the rows for the first time (that
  enabled the coming-back cards).
- One extra hazard came with PR #5859: a card whose display type is unknown now
  silently answers itself "not handled" instead of falling back to the tool name. One
  line fixes it.

So: the foundation was always broken, and recent changes built windows onto it.

## Finding 4: other facts the plan must respect

- The server publishes an event when a row changes. The desktop web app does not
  listen to it. Only the mobile app does. The event also carries no detail: not which
  card, not what happened.
- There is no "one card per turn" rule, and no 10-minute card timeout. Both were
  earlier wrong theories; git history disproved them.
- Mobile can only answer approval cards. The mobile answer endpoint, the server code
  that builds the resume, and the runner's reading of answers all speak "approve/deny"
  only. Form and connect answers have no route from mobile. This was always true.
- The same card can be answered from two places in the code, guarded only by local
  flags.
- The list of card tool names exists twice, in two layers that cannot import each
  other. Adding a tool to one list only produces a card that never resumes, or a
  resume with no card.
