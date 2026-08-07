# WP9 — Commands

Implements the core command vocabulary — `!new`, `!stop`, `!sessions`,
`!use:<id>` — parsed from inbound content using the channel-declared command
sigil, and dispatched onto the existing session/thread machinery. No new
persistence: commands read and write through WP4's resolution and WP1's
service methods.

## Files

New:
- `core/channels/commands.py` — grammar parsing and command dispatch.

## Interfaces

Calls into `ChannelsService` (`entities.md` §8):

```python
async def query_threads(self, *, project_id, thread=None, windowing=None) -> List[ChannelThread]: ...
async def close_thread(self, *, project_id, user_id, thread_id) -> ChannelThread: ...
```

Reads the capability declaration for the sigil and the implemented command
list (`capabilities.md` §2, §3 addressing/commands blocks):

```json
"addressing": { "command_sigil": "!" },
"commands": ["new", "sessions", "use"]
```

`!stop` maps onto the runtime's existing session cancel — the same mechanism
`SessionStreamsService` exposes for `force`/cancel today
(`api/oss/src/core/sessions/streams/service.py`); this package calls that
existing entry point, it does not add a new one.

`!new` creates a new thread row via the inbound resolution path (WP4's
`resolve` / `get_or_create_thread`), which is the same append used for a
fresh thread — `!new` does not get its own DAO method, it is a trigger that
resolves to a new row per D12 (latest row wins, append-only).

`!use:<id>` appends a new thread row pointing at the named earlier session,
via the same append path, with the target validated against
`query_threads` filtered to this thread's own history.

## Contracts this package must honour

- **Grammar is `!command[:arg]`, colon not space** (D13). The command token
  stays self-contained; everything after the colon is the argument, and
  anything after the command word with no colon is not an argument — it is
  message content the agent still receives (a bare `!stop please` is parsed
  as `!stop` with trailing text, not `!stop` with arg `please`, since there
  is no colon).
- **The sigil comes from the capability declaration and is never
  hardcoded.** Read `addressing.command_sigil` per channel; do not assume
  `!`. A channel declaring no command sigil offers no commands.
- **`!sessions` lists only this thread's own history** (D14). Query
  `channel_threads` scoped to this thread's `(space, external key, agent)`
  key — never the project's sessions, never the user's sessions elsewhere.
  This is what makes authorisation trivial: every listed entry already
  belongs to a thread the user is present in.
- **`!stop` maps onto the runtime's existing cancel** (D23). No new
  cancellation mechanism, no exchange counter. Loop hygiene is this explicit
  command, not a heuristic.
- **`!new` mid-turn lets the running turn finish** (D24). Appending the new
  thread row does not cancel the in-flight turn; that turn completes and
  posts against its own (now previous) session. Cancellation is `!stop`, a
  different gesture.
- Where a platform has a native command surface that works in-conversation
  (`addressing.native_commands.in_conversation`), it may register aliases
  producing the same internal command — this package's dispatch is reached
  either way and does not care which surface produced the event.

## Tests

- `!new` parses correctly with the declared sigil and with a different
  declared sigil (assert no hardcoded `!` in the parser).
- `!stop`, `!sessions`, `!use:<id>` each parse; `!use` with no colon/arg is
  rejected or treated as plain content, not silently ignored as a no-op
  command.
- A bare message containing `!` mid-sentence (not at start, or not matching
  the grammar) is not parsed as a command.
- `!sessions` in thread A never returns thread B's history, even for the
  same user across two spaces.
- `!stop` issued mid-turn cancels via the existing runtime mechanism; assert
  no new cancellation code path was added.
- `!new` issued mid-turn: the running turn completes and posts; a new thread
  row exists immediately, pointing at a new session; the old turn's output
  attaches to the old session.
- `!use:<id>` where `<id>` is not in this thread's own history is refused
  (cannot reference another thread's session).
- A channel whose capability declares no command sigil, or omits a command
  from `commands`, never offers that command's dispatch.

## Out of scope

- Any change to the runtime cancel mechanism itself (owned elsewhere; WP9
  only calls it).
- Coalescing / steer-or-queue behaviour on concurrent turns (WP14).
- Native command registration UI/manifest work for a specific platform
  (WP6, WP11 — this package defines the internal command event only).

## Checkpoint

WP9 feeds **C4 — It is pleasant**. Exit condition, verbatim from `plan.md`:

> **Exit condition:** each command works in a real space; messages sent
> between mentions arrive as context on the next trigger; the flag — never a
> count of `PULLED` rows — guards the one-time fetch, and a refusal leaves it
> false. WP5's polling is deleted, not disabled.

WP9's own done-when, also from `plan.md`: "each command works in a real
space, and `!new` mid-turn does not disturb the turn in flight."
