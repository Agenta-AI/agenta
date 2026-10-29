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
"answered" (one small API call that flips the row from `pending` to `responded` and
saves the outcome: the form values, or the connection result). Then it sends the
resume exactly as today. `responded` with a saved outcome IS the settled state for
form and connect cards; `resolved` stays the approval-only end state. We checked
whether the runner could later confirm consumption and mark the row `resolved`: it
cannot know which row it consumed without new plumbing through three layers, for a
status word nothing displays. So we do not build that. Details are in
[implementation.md](implementation.md).

Why this order wins: the sweep only closes `pending` rows. A row that is already
`responded` survives the sweep, with no changes to the sweep at all. Version 1 of the
plan tried to record the answer at delivery time; the review proved the sweep runs
before delivery, so that shape loses the race. Recording first cannot lose it.

The resume waits for the "answered" call, but not forever: the wait is capped at two
seconds. If the call fails, or the cap runs out, the resume goes out exactly as today,
and a late "answered" call still lands if the sweep has not run yet. So a broken call
costs at most today's behavior, never the turn.

The approval card already works this way. We extend its pattern; we invent nothing.

Known limit, stated openly: mobile still cannot answer form and connect cards. That
was always true (research Finding 4) and is its own ticket.

## Change 2: one rule for what replay shows

When the browser rebuilds a chat, each card's state comes from this list, first match
wins:

1. A real recorded answer in the conversation. Show the answered card.
2. An outcome saved on the row (exists only after Change 1). Show that outcome.
3. A row that ended (`cancelled`, `responded` or `resolved`) with no saved answer. Show
   a neutral, dead "interaction ended" card. Never guess whether it was answered or
   abandoned.
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
- Decided (Mahmoud, 2026-08-10): the dock STAYS, as a shortcut. It still appears while
  a card waits, and clicking it scrolls to the card. This keeps the visible UI change
  as small as possible.
- The three code paths that only looked at the last message now scan the whole chat,
  like the status fix (#5913) already does.
- The one-line dispatch repair from research Finding 3 lands immediately, outside this
  project.
- The card tool-name list gets one shared source.

## Filed separately (not in this project)

- Mobile answering of form and connect cards.
- Making the agent's "am I connected?" check verify the connection is valid.
- Reusing an existing connection
  ([#5911](https://github.com/Agenta-AI/agenta/issues/5911)).
- Announcing a carried approval gate again. When one turn raises two gates and the
  resume answers one, the other is parked again but never announced, so the user is
  never asked and its row waits forever. The ordering half was fixed in
  [#5910](https://github.com/Agenta-AI/agenta/pull/5910); the rest sits with the open
  runner race, [#5907](https://github.com/Agenta-AI/agenta/issues/5907).
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
