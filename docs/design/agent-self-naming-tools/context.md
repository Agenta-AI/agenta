# Why this work exists

## What a user sees today

**Sessions carry a truncated first message as their name.** When someone sends a first message in
the desktop chat, the browser takes that message, cuts it at 60 code points, and writes it to the
session's durable name. A list of sessions therefore reads as a column of half-sentences. Nothing
ever improves that name later, because nothing else writes it except a manual rename in the session
rail.

**Agents carry whatever name the creation flow gave them.** An agent created from a template gets
the template's name. An agent created blank gets a placeholder. The description is usually empty. A
person browsing the agents list sees rows that do not say what the agents do, and the only way to
fix that is to type a name by hand in the playground header.

In both cases the party that knows the answer is the agent itself, and it has no way to say it.

## What we are building

Two platform tools, both in the default build kit so every playground agent has them without the
author opting in.

- `rename_session` lets the agent name and describe the session it is running in, once it
  understands what the session is about, and update both later when the session moves on.
- `rename_agent` lets the agent name and describe itself once, typically right after its first
  task, when it understands its own purpose. After the first successful call, persisted workflow
  state prevents later sessions from renaming it again.

Plus the piece that makes either one visible: a project-scoped watch relay, so a rename written by
a server-side actor reaches an open browser tab without a reload.

## Decisions already made

These are settled. Do not re-open them during implementation.

1. **Both tools go into `DEFAULT_BUILD_KIT_OPS`.** They are default build-kit behavior, not an
   author opt-in. Wherever the build kit is present, both tools are present, including
   trigger-minted runs. There is no special case for automation runs: the presence of the build kit
   decides.
2. **The agent may overwrite a name a human typed.** The server records no title provenance and we
   are not adding any. A server-side rename simply shows in the browser. The chat's local title
   must stop beating the server's.
3. **The client-side auto-title stays, and fires only on the first message.** It labels sessions
   the user never opens and sessions on other devices. The agent's better name arrives later and
   supersedes it.
4. **The name and the description have distinct jobs.** The name is the general subject: what the
   session is about, or what the agent is for, short enough to scan in a long list. The description
   is the current state: a recap of one to one and a half sentences that fits a table cell.
5. **The catalog description and default persona carry the instruction.** The description includes
   the current persisted name and field semantics. The persona tells the model to rename only a raw
   request or placeholder. Server-side state remains authoritative even if the model ignores both.

## Done means

- An agent in a fresh playground session calls `rename_session` after understanding the task, and
  the `session_streams` row holds the new name and description.
- A fresh agent calls `rename_agent` after its first task, and the workflow artifact row holds the
  new name, description, and one-time marker, with its flags intact. A later session does not receive
  the tool, and a concurrent or direct second call is rejected by the server.
- Both renames appear in an open sessions list and an open agents list without a reload, in a tab
  that did not make the change.
- Both tools appear in the one-shot benchmark and hold the 95% target on the small-model cells.

## Out of scope

- Server-side arbitration between a human name and an agent name. Decision 2 rules it out.
- Renaming any session or agent other than the one the run belongs to. Both targets are bound from
  run context and stripped from the model's schema.
- Clearing a name. `minLength: 1` plus a non-whitespace pattern on the schema means the tool cannot
  blank a title, by an empty string or by spaces; that stays a human action.
- Widening the watch relay beyond the two entities these tools touch. The mechanism generalizes,
  but each later entity adds its own publish call and its own client handler.
