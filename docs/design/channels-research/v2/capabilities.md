# Channels: the capability declaration

Every adapter — first-party or bridge — answers one question: *what can this
platform do?* Core reads the answer and decides what to offer, what to attempt,
and how to render. Nothing platform-specific is hardcoded in core (D16).

The declaration is **data, not code**. It is fetched from the adapter: an
in-process adapter answers a process call, a bridge answers a wire call. Same
shape either way.

---

## 1. Why it is inbound-first

Outbound rendering concerns — threads, edits, buttons, message length — matter,
but they are not the binding constraint.

The binding constraint is **inbound**: whether the agent can see a message at
all, and what the operator must do to make it so. Four of six studied platforms
gate this by default, each demanding a different action from a different person.
That is user-visible setup and a support burden, not a rendering difference — so
it belongs in the declaration first.

## 2. Shape

```json
{
  "channel": "slack",
  "protocol": { "versions": ["0.1.0"] },

  "addressing": {
    "sigils": { "agent": "~", "command": "!" },
    "mention": true,
    "native_commands": { "supported": true, "in_conversation": false }
  },

  "spaces": {
    "private": true,
    "group": true,
    "topic": true
  },

  "conversation": {
    "units": ["thread", "space"],
    "default_unit": "thread"
  },

  "fill": {
    "backfill": { "supported": true, "requires_permission": "channels:history" },
    "forwardfill": { "supported": true, "requires_permission": "channels:history" }
  },

  "rendering": {
    "message_update": true,
    "buttons": { "supported": true, "max": 5 },
    "text": { "format": "markdown", "max_chars": 4000 },
    "files": { "receive": true, "send": true, "max_bytes": 1073741824 },
    "ephemeral": true
  },

  "identity": {
    "scope": "workspace",
    "stable": true,
    "key_fields": {
      "space":  ["team", "channel"],
      "thread": ["team", "channel", "thread_ts"]
    }
  },

  "commands": ["new", "sessions", "use"]
}
```

## 3. What each block decides

### addressing

Which sigils this channel uses, and whether a mention is even a concept. The
characters differ per channel for real reasons: `@` is destroyed by Slack's
autocompletion before the event arrives, and `/` collides with native command
surfaces on three platforms. The grammar shape is universal; the characters are
not (D13).

`native_commands.in_conversation` is separate from `supported` because a platform
can offer commands that do not work in the place you need them — which is exactly
the case that forces a text convention.

### spaces

Which of `private | group | topic` exist here. A platform with no group concept
simply declares `group: false`, and the configuration UI never offers it.

### conversation

Which units a session can correspond to. `thread` is only offerable where the
platform has a stable key for one; where it does not, the unit degenerates to the
space itself. Core never assumes a thread exists.

`message` — one session per message — is always available and needs no
declaration, since it requires nothing from the platform.

**`default_unit` is what applies when no policy level states a `session_scope`.**
It is the channel-defaults input to the intersection (D25), which is why the
resolver takes channel defaults separately from the three policy documents: a
platform with native threads should thread by default, and one without should not,
without anybody configuring it. It must be a member of `units` — normalisation
rejects a default the adapter did not declare support for.

It is a *default*, not a ceiling: `units` is what constrains, and a stated policy
narrows from there. The two do different jobs and both are needed.

### fill

The most consequential block. `backfill` and `forwardfill` are declared
separately because they are separately capable and separately permissioned:

- **Not supported** — core never attempts it. Telegram has no history API, so
  backfill is not a permission question there, ever.
- **Supported, requires permission** — core attempts it, and records the outcome
  on the attempt (D10), so a permission granted later takes effect on the next
  new thread without setup being re-run.

`requires_permission` is informational — it names what an operator must grant, so
the UI can say why something is not working. Core does not interpret it.

**How much to fetch is configuration, not a declaration.**
`AGENTA_CHANNELS_BACKFILL_LIMIT` (default **50**) caps the one-time fetch, and it
is deliberately *not* a capability field. The reason is Slack: the same adapter
faces 15 objects per minute for a commercially distributed app outside the
Marketplace, and 1,000 at 50+ per minute for a custom or internal one
(`channels.md` §Slack). That is a fact about **how the operator registered their
app**, not about the platform — so no per-channel constant can express it.

Core therefore asks for `AGENTA_CHANNELS_BACKFILL_LIMIT` and takes what it gets:
the adapter clamps to whatever its install actually permits, and a short page is a
normal outcome rather than an error. 50 is chosen to be useful on a generous
install and harmless on a tight one, where the platform simply returns fewer.

### rendering

The outbound half. Limits are declared as data so the renderer can degrade
without knowing which platform it is talking to: an approval with more options
than `buttons.max` becomes numbered text; a message longer than `max_chars` is
split; progress becomes new messages where `message_update` is false.

**`text.format` is one of `markdown | html | plain`**, and deliberately not a
platform's own name for its dialect. Slack calls its variant *mrkdwn* and Telegram
ships *MarkdownV2*; putting either in the declaration would mean core knowing what
those words denote, which is D16 broken at the one field most likely to tempt it.
The renderer targets the declared family and the **adapter** applies its platform's
escaping — that difference is the adapter's job precisely because it is
platform-specific.

### identity

**`scope` is one of `global | workspace | tenant`** — how far a user id is unique.
`global` means the id identifies a person platform-wide (Telegram); `workspace`
means it is unique only within one installation, so the link key must embed the
workspace (Slack, Discord); `tenant` is the same idea one level up, where the
boundary is a customer organisation rather than a single install (Teams). Embedding
a workspace id is correct on some platforms and noise on others, which is why this
is declared rather than assumed.

`stable: false` flags platforms where the id can change under an existing link, and
those need a rebinding path (WP7).

**`key_fields` names which locator fields identify a place**, at each grain, and it
is how `external_key` is composed (`entities.md` §2.2). The adapter supplies the
locator and declares which of its fields matter; **core composes the key and the
adapter never does**. A platform with no threads declares `"thread": []`, and thread
grain composes to null — the same code path as scope-is-the-space.

**`key_fields` names which locator fields identify a place**, at each grain, and it
is how `external_key` is composed (`entities.md` §2.2). The adapter supplies the
locator and declares which of its fields matter; **core composes the key and the
adapter never does**. A platform with no threads declares `"thread": []`, and thread
grain composes to null — the same code path as scope-is-the-space.

This block is declared rather than conventional because the field *set* is the
fragile part. `external_key` is a `uuid5` over these fields, so changing which ones
are named re-keys every existing row and forks every live conversation — silently,
because a hash gives no hint that it used to be computed differently. A declaration
makes that a visible diff and something the contract suite can hold an adapter to.

Two failures the contract suite tests directly:

- **Too few fields** — two distinct threads composing to one key, which merges
  conversations rather than splitting them. Worse than a wrong key, and the reason
  distinctness is asserted rather than assumed.
- **A declared field absent from a real locator** — composition raises
  `ChannelLocatorIncomplete` rather than keying over what happens to be present.

### commands

Which of the core command vocabulary this adapter implements. A bridge that has
not implemented `use` declares so, and core does not offer it.

## 4. Normalisation at the boundary

Values arriving from a bridge are **normalised, never trusted**. A declared
maximum of zero becomes the default; absurd values are clamped; unknown keys are
ignored under a must-ignore rule. Trust-bearing flags are stamped by core and
never read from the wire.

## 5. Contract tests

Every adapter is held to its declaration. The studied failure mode of adapter
ecosystems is the **silent no-op** — a declared capability that quietly does
nothing — so a declaration is a promise the test suite enforces. An adapter
claiming `message_update: true` must demonstrably edit a message; one claiming
`buttons.max: 5` must reject a sixth rather than dropping it.

## 6. What is deliberately not here

**Provisioning state.** Whether an operator has actually granted a permission is
not a capability — it is a fact about the world, discovered by trying, and it
changes without warning (D10). It lives with the connection, refreshed on
failure, not in the declaration.

**Per-install configuration.** Which spaces are enabled, which agent is the
default, what the session scope is — all stored per row. The declaration says
what is *possible*, never what is *chosen*.

**Policy.** `backfill`, `forwardfill`, `session_scope` and `triggers` appear both
here and in the policy documents (D25), and they mean different things: here,
whether the platform *can*; there, whether the operator *wants* it. The
declaration is the outermost constraint — a capability of `false` denies the
field no matter what any policy level states, and no policy can turn it on. So
capability is simply one more level in the same intersection, the one nobody can
edit.
