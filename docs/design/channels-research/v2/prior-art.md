# Prior art: an independently-built channels stack

Researched 2026-08-08, at C4, before redesign. Four sources, all shipped in the
last six weeks:

| Source | What it is | Age |
| --- | --- | --- |
| `channels-sdk` | open SDK: any agent into Slack/Teams/Discord/Telegram | created 2026-07-16, 813★ |
| `OpenTag` | a reference agent built on it, self-hosted, Slack + Teams | pushed 2026-08-08, 1026★ |
| `ag-ui` | the agent↔frontend event protocol underneath it | established |
| the hosted product | the managed credential/delivery plane | live |

## Why this matters to us

They built the same thing, independently, and arrived at nearly the same
decomposition. That is corroboration for the parts we match on, and a much
sharper signal on the parts we do not.

## Where their design matches ours

Their `PlatformAdapter` and our channel adapter are close to the same object:

| Their contract | Ours |
| --- | --- |
| ingress: turns, interactions, commands, thread-started | inbound events with an addressed flag, commands |
| egress: `post` / `update` / `stream` / `delete` | post/edit, streaming, the outbox |
| a neutral message IR the adapter renders | our content list, rendered per adapter |
| a declared `capabilities` object, feature-detected | our capability declaration |
| optional methods gated on capabilities | our declared-then-gated methods |

Two of their rules are ones we learned the hard way:

- **"the renderer must be total, never throw on an unsupported node. That's what
  makes cross-platform degradation work."** Same conclusion as our
  degrade-don't-fail rule.
- **"must recover the content-stable action ID"** on interaction decode. This is
  the button-identity problem: an action is addressed by a locator that survives
  the round trip, not by position.

## Where they are ahead of us

### 1. Provisioning is a separate plane, and it is the product

The split their reference deployment states outright: *"The Slack and Microsoft
Teams adapters, their credentials, and attachments are configured only in
Intelligence — never here."* And: *"The API key selects a project; the Channel
name selects a Channel inside it. Slack and Teams credentials do not belong
here."*

So the operator's own service holds **no platform credentials at all**. Its
entire channel configuration is:

```
INTELLIGENCE_API_KEY      # selects a project
INTELLIGENCE_CHANNEL_NAME # selects a channel in it
```

A hosted plane owns the app manifest, the OAuth install, the secrets, and the
ingress. This is exactly the gap `F47` names, resolved by moving it out of the
runtime entirely rather than by building a config surface in it.

Note what this costs: the managed path is a dependency, and the same repo
documents a self-host escape hatch whose guides are "coming soon".

### 2. A manifest is generated per channel, not written once

Their manifest is generated from the channel's declared handlers, which is the
piece our uncalled manifest builder was written for and never got.

### 3. The agent-facing protocol is already standard

They do not define an agent wire format; they consume `AG-UI`, which is
`RunStarted`/`RunFinished`, `TextMessage*`, `ToolCall*` including
`ToolCallResult`, `StateSnapshot`/`StateDelta` (JSON Patch), `Activity*`,
`Reasoning*`, `Raw`/`Custom`. Human-in-the-loop rides `RunFinished` with
`outcome.type: "interrupt"` and an `interrupts` array; the client resumes with a
`resume` array.

Worth weighing against our own turn/session events before inventing more.

## Where we are ahead, or at least not behind

- **They hit our `F36` and shipped it.** Verbatim: slash commands and modals
  *"compiled, started, reported online, and never fired"* because the generated
  manifest declared neither. Handlers registered in code, unreachable in
  practice — the exact defect our reachability sweep exists to catch, in a
  1000-star repo, documented as a caveat rather than fixed.
- **They hit our `F46` and documented it instead of constraining it.** Channel
  names are claim-based: *"Two runtimes declaring the same Channel name in the
  same project race per delivery, and the loser silently receives nothing."* A
  name-keyed lookup with no scope and a silent loser — our unscoped
  `integration_key` with the same failure mode. Their mitigation is prose.
- **Their trigger routing is asymmetric and they say so:** a mentioned turn goes
  to `onMention` or falls back to `onMessage`; an unmentioned turn reaches only
  `onMessage`; `onMention` subscribes the thread, which is what lets unmentioned
  follow-ups run. Close to our addressed/sigil model, and it confirms the
  subscribe-on-address behaviour is the right default.
- Our bridge has no counterpart here: their non-first-party platforms are direct
  SDK adapters, not a wire contract a third party implements. Whether that is an
  advantage depends on whether anyone outside us ever writes one.

## What to take into the redesign

1. **Split provisioning from runtime.** Credentials, manifest and install belong
   to a configuration plane, not to the process handling messages. Ours currently
   has neither plane.
2. **Declare credentials next to capabilities.** They get this for free by
   holding credentials elsewhere; we need the schema `F47` asks for, because we
   are keeping them in `connection.data`.
3. **Generate the manifest from declared handlers**, so a registered command
   cannot be absent from the manifest. That single rule would have prevented
   their shipped defect and ours.
4. **Scope the channel lookup.** Both designs independently produced an unscoped
   name-keyed resolve with a silent loser. Theirs is documented; ours should be
   constrained.
5. **Evaluate AG-UI as the agent-facing contract** rather than growing our own.
