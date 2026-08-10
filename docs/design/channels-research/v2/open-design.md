# Open design items

The list the redesign works from. Written at C4, after wave 4 and after reading a
comparable stack built independently.

Target surfaces, in order: **Slack, Telegram, Discord**. Designed against a
text-only floor, because the surfaces are unequal and the poorest one is what stops
the design drifting into Slack's feature set.

## Written, awaiting review

### 1. Provisioning — `provisioning.md`

One declared credential schema, three per-platform flows. The Slack manifest is
generated from the configuration rather than from code, with the installed hash
stored so drift is visible.

### 2. Rendering across unequal surfaces — `rendering.md`

Degrade to text, never to nothing. A node vocabulary where every node declares its
text fallback; a pending choice answerable by clicking *or* by replying with a
number; forms as sequences of questions; modals excluded.

## To design

### 3. Button clicks

Nothing parses a click. The adapter returns early on anything that is not
`event_callback`, and a click arrives as `block_actions`. `rendering.md` decides
*how* a choice resolves — thread plus short token, so a numbered reply and a click
are the same event. What remains is the parsing and the event kind.

Note this is what made C4's exit condition unreachable as originally written.

### 4. Capabilities is missing two axes

It declares what a channel **can do**, and needs to declare:

- **what it needs** — the credential schema, which is why provisioning has nowhere
  to live.
- **what to do instead** — the per-node text fallback, which is why rendering has
  no answer for a surface without buttons.

Both gaps only appeared once a second adapter existed. They are one change.

### 5. Per-connection capabilities

Declarations are keyed on the channel name, so every connection on a channel shares
one. Two bridges therefore share a declaration, and the second is validated against
the first's locator fields. Half of an already-recorded finding; the verification
half is fixed.

### 6. A mock channel worth keeping

The mock adapter is real but has no surface — nothing posts to it over HTTP, so no
journey can be driven end to end without a platform.

The ask is a **usable channel UI**, not a throwaway harness: it drives
provisioning-time *and* run-time, so the whole journey is testable before Slack
credentials exist. Since it must render our node vocabulary and answer choices, it
is the same work as a web surface — so build it as a web package rather than a
scratch app. It is then the reference renderer for the vocabulary, and plausibly a
product surface later.

This is what makes items 2, 3 and 8 testable without a platform.

### 7. Multi-tenancy of a platform app

Not one Slack app: **many**. An Agenta-provided app installable by many customers,
plus customers' own apps for their own workspaces. That decides:

- whether credentials are per-connection or shared by an app across connections
- what the connection lookup keys on, which is where an unscoped key already lets
  one tenant's event resolve against another's connection
- whether the manifest is per-installation or per-app

**Partly answered by research** (see `prior-art.md`): a comparable platform offers
both an own-brand app and a customer-owned app, and declares the capability
difference — the shared app cannot do commands, modals or event subscriptions,
because those belong to the app rather than the installation. `provisioning.md` now
carries that as its section 0. What remains is whether we offer both, and how a
customer moves from one to the other.

### 8. Identity linking

A platform user becoming an Agenta account. There is a table and there are grant
findings; there is no design for the flow.

### 9. The configuration surface

What a user actually sees: which agents on which spaces, which commands enabled,
which spaces discovered. `provisioning.md` assumes this exists. Related to 6 — the
same web work.

### 10. The bridge: live or die

Not a finding, a decision. It exists so a third party can add a channel without us.
Nobody has asked. A comparable product covers eight surfaces with first-party
adapters and no extension point, which shows the adapter route scales — it does not
show a bridge is worthless.

What is already built: the adapter, the wire contract, the identity rule, an
out-of-process test counterpart. Keeping it costs the per-connection capability
work; dropping it recovers that and removes a public route.

## Explicitly parked

- **The agent-facing event protocol.** Adopting the standard one would mean
  reshaping turns, sessions and the outbox around another event model. Too deep for
  what it buys today.
- **Input sequencing.** Two messages arriving mid-turn. This is the **runner and
  sessions** concern, not a channels one — channels works without it and needs no
  revisit when it lands.
- **Distribution and a community catalogue.** A product decision, and the contract
  already pre-commits that community code is never auto-installed.

## User journeys

Packages alone produced a system nobody can use: coherent, correctly ordered, and
four checkpoints in with no way to configure a channel. So the journeys get designed
alongside the packages, and each one has to name the packages that complete it.

The three to write:

1. **Provisioning** — from "I want my agent in Slack" to a verified connection: app
   created, installed, credentials stored, inbound URL live, event received.
2. **Usage** — a message addressed to an agent, answered in thread; a command; a
   choice answered both by click and by number; backfill on first contact.
3. **Operations** — the manifest drifts from the configuration; a credential is
   revoked; a connection is removed; a platform stops delivering.

Journey 1 is the one that would have caught the provisioning gap in week one.
