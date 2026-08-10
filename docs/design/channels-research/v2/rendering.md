# Rendering across unequal surfaces

Target surfaces, in order: **Slack, Telegram, Discord**. Designed so the poorest
plausible surface — SMS, plain text, no interactivity at all — still works, because
that is what stops the vocabulary drifting into Slack's feature set.

## The one rule that decides everything

**Degrade to text, never to nothing.**

A node the surface cannot render must still deliver its *meaning* as text. Dropping
a chart loses decoration; dropping a button loses the choice, and the conversation
stalls with the user unable to answer.

The tree already does this for one case: more buttons than the surface allows
renders as `1. Retry` / `2. Cancel`. That behaviour is right and is currently
Slack-local and count-triggered. It generalises: the same numbered form is what
every surface with no buttons gets.

## Node vocabulary

Small and typed, because an **agent** emits these and a **user** configures what is
allowed — nobody writes markup. Each node declares its own text fallback.

| Node | Slack / Discord | Telegram | Text-only |
| --- | --- | --- | --- |
| `text` | markdown | markdown | plain |
| `buttons` | block buttons | inline keyboard | numbered list |
| `select` | select menu | keyboard rows | numbered list |
| `fields` | field pairs | `label: value` lines | `label: value` lines |
| `table` | fixed-width block | fixed-width block | first column, truncated |
| `image` | image block | photo + caption | the URL |

`divider` and `section` are deliberately absent: they carry no meaning, only
layout, so they have nothing to degrade *to*. If a node's text fallback is empty,
the node does not belong in the vocabulary.

**Text is the floor.** Every surface renders `text`, so a message that degrades all
the way down is still a message.

## Choices must be answerable in text

This is the part the existing fallback misses. It renders `1. Retry` and nothing
resolves a reply of `1`.

So a choice has two halves that must agree:

- **Rendered**: a button carrying an id, or a numbered line.
- **Answered**: a click carrying that id, **or a message whose text is `1`**.

A reply of "1" in a thread with a pending choice is the same event as clicking the
first button. Both resolve to one pending action.

That constrains the id: it must be resolvable from **the thread plus a short
token**, because a text-only surface carries no payload. An opaque uuid in a button
value cannot work — there is nowhere to put it when the same choice is a numbered
line. So the pending choice is stored against the thread, and the token indexes
into it.

Consequences worth stating:

- A pending choice is **state on the thread**, not data in a message. It has to be,
  or the numbered form cannot resolve.
- It **expires or is superseded** — a stale `2` must not answer a question from an
  hour ago. Newest pending choice wins; older ones stop accepting.
- The label is the agent's own words. The token is ours. The user never sees ours.

## Forms: sequential, not modal

Slack has modals. Telegram and Discord do not have the same thing, and a text-only
surface has nothing. A form is therefore **a sequence of questions in the thread**,
which is the only shape all three share.

This is the same mechanism as a choice, repeated: ask, hold the pending answer on
the thread, accept a reply, ask the next. No new primitive.

**Modals are out of scope.** Not deferred pending design — excluded, because
building them means the richest surface gets a feature the other two cannot have,
and every message path then has two shapes forever.

## Where the check happens

Degradation is invisible to the person configuring the channel, so the product must
surface it **when they save**, not when a message is sent at 3am.

- A configuration that needs a capability the connection's surface lacks is
  reported at save time, against the declared capabilities.
- Rendering itself stays total: it always produces something, so a message never
  fails to send because of a node.

Two different rules, and both are needed: **loud at configuration, forgiving at
delivery.**

## What this replaces

The current capability declaration says `buttons.supported` and `buttons.max`.
That is enough to decide *whether* to render buttons and not enough to decide *what
to render instead*. The fallback per node above is the missing half.
