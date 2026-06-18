# Agent chat: rewind / branch a conversation

Status: design (for review) → initial implementation in progress
Scope: the agent-chat slice (`web/oss/src/components/AgentChatSlice/`)
Related: `frontend-agent-chat-ui.md` (the slice), `agent-protocol-rfc.md` (sessions, stateless replay)

## TL;DR

Let the user **rewind a conversation to an earlier turn** and continue from there (edit a
past message and re-run, or retry an assistant turn). This splits into **two independent
axes** — the *conversation* (the transcript) and the *world* (the agent's external side
effects). The conversation axis is cheap and safe and is what we build first. The world axis
is **not generically reversible** for an agent (you can't un-send an email), so we do **not**
fake it — we gate it, exactly like Claude Code does.

## Why two axes (and the Claude Code precedent)

Claude Code — itself a coding agent — ships precisely this feature, and its menu makes the
split explicit: *Restore conversation* / *Restore code* / *Restore both*. Its mechanics:

- **Conversation**: truncate the transcript to the chosen message (within the session); the
  selected prompt is restored to the input for re-send/edit. Forking to a new session is a
  separate op.
- **Code (the world)**: snapshots files **before each edit / at each user prompt**, stored
  locally and **separate from git**. *Restore code* reverts those tracked files.
- **The hard limit** (documented): it reverts only file edits made through its file tools. It
  **cannot** undo Bash side effects (`rm`, DB writes, API calls, deploys), external edits, or
  remote state — *"not a replacement for version control"*, and *"this is why Claude asks
  before running commands with external side effects."*

The lesson for us: **rewind the part of the world you can snapshot; gate the rest.** Claude
Code's world is mostly the local filesystem (snapshottable). A general agent's world (emails,
payments, DB rows) usually is not — so for us the "Restore world" axis mostly doesn't exist,
and we lean on gating (our approval flow already does this).

## What makes this cheap for us

The agent protocol is **stateless per turn**: the FE re-POSTs the full history every turn,
and the server does not reconstruct conversation state (`agent-protocol-rfc.md` §4.3). So
**conversation rewind is a pure frontend operation** — mutate `useChat.messages`, re-send.
No server rewind endpoint is needed. The `useChat` primitives we use:

- `setMessages(updater)` — truncate the transcript.
- `regenerate({messageId})` — re-run a specific assistant turn (SDK drops it + after, re-runs).
- `sendMessage({text})` — submit the edited turn.

## Scope

### v1 (this doc, build now) — conversation rewind, truncate-in-place

- **Rewind to a user turn**: drop that user message and everything after it, prefill the
  composer with its text. The user edits or resends → a fresh turn streams into the
  now-shorter conversation. (This is the ChatGPT/GitHub "edit message" pattern.)
- **Retry an assistant turn**: `regenerate({messageId})` re-runs it. (Today only the last
  turn has Retry; v1 keeps that, v1.1 extends to any turn.)
- **Side-effect guard** (the agent-specific bit): before a rewind that drops a turn
  containing a **side-effecting tool result**, show a confirm naming what won't be undone
  (e.g. *"`send_summary_email` already ran — rewinding won't un-send it."*). Read-only tools
  (`search_docs`) rewind silently.

### Deferred

- **Branching / fork** (keep both paths in the UI, tree view): needs a new session per
  branch — Pi exposes `fork()` / `importFromJsonl()`, and the RFC reserves `session/load`.
  v1 is destructive truncate-in-place; the old branch survives only in the trace store.
- **World rewind**: not generically possible; only ever for tools that declare a reversible
  / compensating action (see below). Out of scope for v1.
- **Server-authoritative history**: if a future RFC version makes the server own history
  (§4.3), rewind needs a server truncate/fork call. Today it's FE-only.

## The tool contract this surfaces (proposal for the RFC)

The side-effect guard needs to know which tools are safe to rewind past. v1 hardcodes a
`READ_ONLY_TOOLS` set in the slice, but the principled home is the tool spec. Propose adding
to `ResolvedToolSpec` (and the RFC) a capability flag:

```jsonc
{ "name": "search_docs", "readOnly": true }        // safe to rewind/retry freely
{ "name": "send_summary_email", "readOnly": false } // side-effecting → confirm on rewind
```

This is the same signal that should drive auto-approval policy and idempotent-retry behavior —
worth raising on `agent-protocol-rfc.md` alongside the approval parts.

## UX

- A **"Rewind here"** hover action on user messages (and "Retry" on assistant messages),
  living in the existing hover-reveal toolbar.
- On click: messages after the point are removed; for a user-message rewind the composer is
  prefilled with that message's text and focused.
- A **confirm step only** when the removed range contains a non-`readOnly` tool result,
  naming the irreversible action(s).
- The re-run streams a fresh turn (new trace) into the shorter conversation.

## Implementation plan (v1)

1. `assets/rewind.ts` — pure helpers: `messageText(msg)`, `sideEffectingToolsInRange(msgs)`
   (returns tool names that are not in `READ_ONLY_TOOLS` and have an output), and the
   `READ_ONLY_TOOLS` set.
2. `AgentChatConversation` — own the rewind action (it has `useChat`): `handleRewind(message)`
   → optional confirm → `setMessages(slice(0, idx))` + `setInput(text)` for user turns;
   `regenerate({messageId})` for assistant turns. Pass `onRewind` down.
3. `AgentMessage` — add the "Rewind here" affordance (user messages get a small hover action;
   assistant messages already have the toolbar).

## Risks / open questions

- **Auto-resume interplay**: `sendAutomaticallyWhen` (approval auto-resume) must not fire on a
  truncated history mid-rewind — truncation lands on a user turn, so it won't.
- **Trace accumulation**: every re-run adds a turn/trace under the session; the abandoned
  branch is visible in observability (arguably a feature). No cleanup in v1.
- **`readOnly` is hardcoded** in v1; the real fix is the tool-spec flag above.
