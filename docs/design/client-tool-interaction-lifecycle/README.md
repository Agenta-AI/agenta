# Interaction cards: research and fix plan

An agent can ask the user for something in the middle of a run. The chat then shows a
card. The user acts on the card. The run continues.

We have three kinds of cards:

| Card | What it asks | Example |
|---|---|---|
| Form card | Fill in some fields | "Pick a time and a timezone" |
| Connect card | Connect an external account | "Connect Telegram" |
| Approval card | Allow or deny a tool call | "Allow the agent to create a schedule?" |

On 2026-08-10, Mahmoud hit many bugs with these cards in one session. Cards came back
after he answered them. Dead cards blocked the screen. A warning strip accused his own
tab. This folder explains why, and what we will change.

## Read in this order

1. [context.md](context.md) — what the user saw, in his words.
2. [research.md](research.md) — how the system really works, and where it lies.
3. [plan.md](plan.md) — the four changes we will make.
4. [qa.md](qa.md) — the tests that will catch this class of bug forever.
5. [status.md](status.md) — where the work stands.

## The words we use (same words in every file)

- **Card**: the widget the user sees and acts on.
- **Interaction row**: one database row per card. It stores the card's state:
  `pending` (waiting), `resolved` (answered), or `cancelled` (closed without an answer).
- **Record list**: the server's saved history of the conversation. The browser can
  rebuild the whole chat from it. We call that rebuild **replay**.
- **Adoption**: the browser throws away its own copy of the chat and takes the server's
  replay instead.
- **The sweep**: a cleanup job. At the start of each new turn, it closes old `pending`
  rows by setting them to `cancelled`.
- **Park**: the run stops and waits for the user to act on a card.
- **Resume**: the run continues after the user acted.
- **Runner**: the service that runs the agent.

## Fixes already merged on 2026-08-10 (before this plan)

- [#5904](https://github.com/Agenta-AI/agenta/pull/5904): the agent no longer guesses
  file paths for its skills.
- [#5909](https://github.com/Agenta-AI/agenta/pull/5909): Telegram connect uses the
  right login type, errors show on screen, and "Not now" really declines.
- [#5910](https://github.com/Agenta-AI/agenta/pull/5910): the runner no longer loses
  the result of an approved tool call.
- [#5912](https://github.com/Agenta-AI/agenta/pull/5912): cancelled cards come back
  dead, not alive.
- [#5913](https://github.com/Agenta-AI/agenta/pull/5913): the "running somewhere else"
  strip no longer shows in the tab that owns the run.

Open issues: [#5907](https://github.com/Agenta-AI/agenta/issues/5907) (runner race),
[#5911](https://github.com/Agenta-AI/agenta/issues/5911) (reuse an existing connection).
