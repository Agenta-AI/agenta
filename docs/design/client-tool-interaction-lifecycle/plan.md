# Plan: four changes

Read [research.md](research.md) first. This is version 2 of the plan. An adversarial
review rejected version 1, mostly for being too big and for one real design error. The
review history is in [status.md](status.md).

## The idea in one sentence

Record the answer first, read it by one rule, listen for changes, and let every card
work where it appears.

## Change 1: record the answer before anything else

Today: the user answers, the resume goes out, the row stays `pending`, the sweep later
marks it `cancelled`. The truth is lost (research Finding 1).

New behavior: when the user answers a card, the browser FIRST tells the server
"answered" (one small API call that flips the row from `pending` to `responded`). Then
it sends the resume exactly as today. When the runner consumes the answer, the server
sets the row to `resolved` and saves the outcome (the form values, or the connection
result).

Why this order wins: the sweep only closes `pending` rows. A row that is already
`responded` survives the sweep, with no changes to the sweep at all. Version 1 of the
plan tried to record the answer at delivery time; the review proved the sweep runs
before delivery, so that shape loses the race. Recording first cannot lose it.

If the "answered" call fails, nothing blocks: the flow falls back to today's behavior.

The approval card already works this way. We extend its pattern; we invent nothing.

Known limit, stated openly: mobile still cannot answer form and connect cards. That
was always true (research Finding 4) and is its own ticket.

## Change 2: one rule for what replay shows

When the browser rebuilds a chat, each card's state comes from this list, first match
wins:

1. A real recorded answer in the conversation. Show the answered card.
2. An outcome saved on the row (exists only after Change 1). Show that outcome.
3. An old row that says `cancelled` with no saved answer. Show a neutral, dead
   "interaction ended" card. Never guess whether it was answered or abandoned.
4. Nothing above applies: the card is still open. Show it live and clickable.

Version 1 wanted a new record type for answers. The review showed the conversation
already records them; a second copy would only create ordering conflicts. Dropped.

## Change 3: the browser listens, and stops overwriting

Two small things:

1. The desktop web app subscribes to the row-change event the server already sends
   (today only mobile listens). On the event: re-read the rows, update the cards.
2. One new adoption rule: while the tab shows a waiting card, the browser must not
   adopt the server's copy of the chat, unless that copy settles the same card.

No new event payloads, no per-card patching machinery. If plain refresh proves too
slow one day, we can enrich it then.

## Change 4: cards work where they appear

- The buttons live ON the card, wherever it is in the chat. The bottom dock becomes a
  pointer to the card, not the owner of the buttons. This kills the dead-card bug at
  its root.
- The three code paths that only looked at the last message now scan the whole chat,
  like the status fix (#5913) already does.
- The one-line dispatch repair from research Finding 3 lands immediately, outside this
  project.
- The card tool-name list gets one shared source.

## Filed separately (not in this project)

- Mobile answering of form and connect cards.
- Making the agent's "am I connected?" check verify the connection is valid.
- Reusing an existing connection (issue #5911).
- Small cleanups: stale form drafts, one missing error catch, one unreachable sweep
  edge case.

## How we prove it works

- The table in research Finding 1 becomes a permanent test: every card kind, every
  outcome, asserted against the real API.
- Replay tests for every line of the Change 2 rule, identical across both replay code
  copies, with old-style rows included.
- One race test: answer a card, delay the resume, run the sweep, assert the row
  survived.
- The live scenario that started this project: form, connect, schedule in one
  conversation with reloads in between. Every card appears once, works where it is,
  and nothing comes back from the dead.
