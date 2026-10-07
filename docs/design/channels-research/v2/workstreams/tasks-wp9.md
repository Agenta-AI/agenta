# WP9 tasks — Commands

## Setup

- [ ] Branch from WP4 (depends on it per `plan.md`). Confirm
      `ChannelsService.query_threads` / `close_thread` and the capability
      declaration's `addressing`/`commands` blocks are reachable.
- [ ] Add `core/channels/commands.py` skeleton: grammar parser function,
      command dispatch function, no command bodies yet.

## Grammar

- [ ] Implement the `!command[:arg]` parser: sigil read from
      `addressing.command_sigil`, colon splits command from argument, no
      colon means no argument and the command word is still isolated from
      trailing message content per the grammar (verify against D13's stated
      shape — do not invent a space-delimited fallback).
- [ ] Test: parser rejects a hardcoded `!` when the fixture declares a
      different sigil.
- [ ] Test: mid-sentence sigil characters do not parse as a command.

## Command bodies

- [ ] Implement `!sessions`: call `query_threads` scoped to this thread's key
      only. Test: never returns another thread's rows for the same user.
- [ ] Implement `!new`: append a new thread row via the resolution path.
      Test: mid-turn `!new` does not cancel the running turn; new thread row
      exists immediately; running turn's output attaches to the prior
      session.
- [ ] Implement `!use:<id>`: validate `<id>` against this thread's own
      `query_threads` result before appending a new thread row pointing at
      it. Test: an id outside this thread's history is refused.
- [ ] Implement `!stop`: call the runtime's existing cancel entry point.
      Test: assert no new cancellation code was written — the call goes
      through the existing mechanism only.

## Capability gating

- [ ] Test: a channel declaring no command sigil offers no commands.
- [ ] Test: a channel whose `commands` list omits e.g. `use` never dispatches
      `!use`.

## Native alias path

- [ ] Confirm (test double) that a native-command-originated event mapped to
      the same internal command dispatches identically to the text-parsed
      path — no special-casing by origin inside `commands.py`.

## Definition of done

Each command works in a real space, and `!new` mid-turn does not disturb the
turn in flight.
