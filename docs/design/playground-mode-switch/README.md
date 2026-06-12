# Playground mode switch (chat ⇄ completion)

Working docs for letting users switch a chat app's playground between chat
mode (multi-turn conversation) and completion mode (single-turn, N test
cases) at runtime, without losing data in either direction.

Design source: the handoff bundle at `design_handoff_playground_mode_switch/`
in the repo root (open `Mode Switch Exploration.html` for the boards; its
`README.md` is the visual spec). Where this plan deviates from the handoff,
[context.md](context.md) records the deviation and the reason.

## Files

| File | Purpose |
|---|---|
| [context.md](context.md) | What we build and why, scope decisions, product rules (the invariants) |
| [research.md](research.md) | Codebase map: mode derivation and its consumers, the chat working copy and its adapter, sync state, reusable UI |
| [plan.md](plan.md) | The PR stack with tasks and test strategy |
| [status.md](status.md) | Progress, decisions, next steps. Read this first in a new session |

## TL;DR

- `is_chat` does two jobs today: it says the app accepts a messages input
  (a capability) and it picks the playground UI (a behavior). We split
  them. The behavior becomes a playground-level override atom, persisted
  per app, never versioned. Scope: chat apps only, so every run stays an
  ordinary chat request and the backend never changes.
- The conversation already lives in the test case row's `messages` column;
  a bidirectional adapter keeps it in sync with the chat UI in real time.
  We reuse that column as the frozen history. No new `history` column.
- Chat → completion: move the last assistant reply from `messages` into
  the row's result slot; runs then regenerate that reply per row.
  Completion → chat: `messages` plus the latest result become the
  conversation again (picker when several rows are loaded; tabs come in a
  later PR).
- A sync gate blocks switching while test cases have unsynced changes
  (with a quiet "Switch without syncing" escape hatch). The toggle is
  disabled in compare mode and stays behind a flag until both directions
  work (end of PR3).
