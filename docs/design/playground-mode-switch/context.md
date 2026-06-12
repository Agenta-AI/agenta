# Context

## Background

The playground ships two separate surfaces today:

- **Chat playground**: multi-turn. One loaded conversation. Each Run appends
  an assistant turn. Hard-gated to a single test case row.
- **Completion playground**: single turn. N test cases loaded from a test
  set. Each Run regenerates one output per row.

Which surface you get is decided by the app, not the user. The workflow
entity's `flags.is_chat` flag (with a schema fallback) picks the surface.
That flag does two jobs at once: it states a capability (this app accepts a
messages input) and it dictates a behavior (render the chat playground).
Users cannot run a chat app against a table of test cases without recreating
the app.

## What we build

One playground, one toggle. A segmented `Chat | Completion` control in the
generations panel header switches the playground of a **chat app** between
the two behaviors:

- **Chat → Completion**: the conversation freezes into the test case row.
  The last assistant reply moves out of the row's `messages` column and into
  the row's output slot. Each Run then regenerates only that final reply.
  The user can load and run multiple test cases.
- **Completion → Chat**: a test case's `messages` column plus its latest
  output become the conversation again. The user picks one test case when
  several are loaded; the rest stay in the test set.

Capability and behavior become two separate pieces of state. The capability
stays derived from the app. The behavior is a playground-level override that
defaults to the capability and is never committed or versioned.

## Scope decisions

1. **Chat apps only.** The toggle appears only when the app is
   chat-capable. A chat app in completion mode still sends ordinary chat
   requests (history in, one reply out), so the feature needs no backend
   changes. Giving completion apps a chat mode would require backend
   support for conversations and is a separate feature.
2. **Reuse the `messages` column.** The handoff design froze the
   conversation into a new `history` column. The conversation already lives
   in the row's `messages` column, kept in sync by an existing
   bidirectional adapter (research.md, section 3). We reuse it. Banner and
   dialog copy say `messages` instead of `history`.
3. **Picker before tabs.** Chat stays single-conversation for now.
   Switching completion → chat with several rows asks the user to pick one.
   Test-case tabs (handoff board 3C) remain the end state and land in the
   last PR, after the chat working copy is re-keyed per row. The handoff
   rejected pickers as the end state; we use one only as staging.
4. **Sync gate keeps the escape hatch.** The gate's footer keeps the quiet,
   left-aligned red "Switch without syncing" text button next to Cancel and
   the primary "Sync & switch".
5. **Compare mode disables the toggle.** In comparison view (more than one
   variant displayed) the segmented control is disabled with a tooltip.
   This avoids inventing a "focused variant" concept for deciding whose
   replies freeze into the row.
6. **Toggle hidden until both directions work.** The control ships behind a
   flag in PR2 and becomes visible at the end of PR3, together with the
   sync gate.

## Product rules (the contract)

From the design's state-mapping table and edge-case matrix, adjusted for the
`messages` column decision. These are the invariants the implementation must
keep:

- The prompt template (system message + `{{vars}}`) belongs to the variant.
  It never moves between modes and is never written into the row's
  `messages` column.
- Round-trip with no edits is identity: no duplicated system message, no
  lost turns.
- A switch never deletes data. Everything is recoverable from the test set.
- Run metadata (latency, cost, trace links) on turns that freeze into the
  row is dropped. The `messages` column is plain editable data.
- Only the **latest** output becomes a turn on completion → chat. Earlier
  runs stay in run history / observability.
- Mode is playground/local state. It is not part of the variant config and
  is never committed or versioned.

## Goals

- Switch modes in place, instantly after dialogs, no page reload.
- Both directions reversible and lossless (via the sync gate).
- Completion mode for chat apps: N test cases, each with its own frozen
  conversation, runs that regenerate one reply per row.
- The switch transform is pure and unit-tested.
- No backend or API changes.

## Non-goals

- No chat mode for completion apps (needs backend work; separate feature).
- No multi-conversation chat until the final PR (tabs and the per-row
  re-keying that enables them).
- No change to how apps declare `is_chat`. The flag stays the default mode.
- No per-variant mode. One global control.
- No redesign of existing message cards, variable cards, output cards, Run
  buttons, or modals. The new chrome (segmented control, dialogs, banner,
  later the tab strip) is the only new UI.
- No new animations beyond existing conventions. An optional 0.2s opacity
  crossfade on the generations body is acceptable.

## Design fidelity note

The handoff mocks follow the Agenta design system, but the production
playground defines the canonical styling for message cards, variable cards,
and outputs. Where mock and app disagree on those, the app wins. The new
chrome must match the spec precisely (exact paddings, colors, and copy are
in the handoff README, sections "Screens / Views" and "Design Tokens"),
except where the scope decisions above change the copy.
