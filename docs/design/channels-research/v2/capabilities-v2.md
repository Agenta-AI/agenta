# What a channel declares

Today the declaration answers one question — *what can this channel do?* — across
`addressing`, `spaces`, `conversation`, `fill`, `rendering`, `identity` and
`commands`. Three things are missing, and each one is why an open item has nowhere
to live.

## 1. What it needs — the credential schema

> **Superseded by [journeys.md](journeys.md) §0.** This section proposes a typed
> field list as a new mechanism. It is not needed: the `CHANNEL_SECRET` kind's
> nested inner kind already discriminates the stored body per channel, so what is
> stored and what is valid are settled by the secrets domain's own validator. What
> the declaration still owes is what the **form** renders — label, help text,
> whether the field is a password box — and that is the three-slot setup contract,
> not a second type system.

Nothing says what a channel must be **given**. Six credential key names exist across
two adapters, none documented, one pair invented by the package that wrote it. The
shared contract suite had to hardcode one platform's field names because there was
no schema to consult.

This is what lets the configuration form be generated, a save be validated, and the
contract suite build a valid connection for *any* adapter instead of for one.

## 2. What to do instead — the fallback per node

`rendering` says `buttons.supported` and `buttons.max`. That is enough to decide
*whether* to render buttons and not enough to decide **what to render instead**.

The target surfaces are unequal and the floor is text with no interactivity at all.
So each node type declares its text fallback, and the rule is *degrade to text,
never to nothing* — dropping a chart loses decoration, dropping a choice stalls the
conversation.

Detail is in `rendering.md`; the declaration is where it has to live, because the
renderer reads it per connection.

## 3. Per connection, not per channel

`fetch_capabilities(channel: str)` keys on the channel name, so every connection on
a channel shares one declaration. That is wrong in three ways that are already real:

- Two bridges share a declaration, and the second's space is validated against the
  first's locator fields. Recorded, half-fixed, still open.
- **An Agenta-owned app and a customer-owned app differ in capability** — commands,
  modals and event subscriptions belong to the app, not the installation. Same
  channel, genuinely different declarations.
- A workspace can decline a scope at install. Two Slack connections on the same
  channel then differ in what they can actually do.

So the declaration is a property of **the connection**, and the channel supplies its
default.

## Why these three are one change

They are the same type and the same call site. Splitting them means touching
`ChannelCapabilities` and every adapter three times, and living with a
half-per-connection declaration in between — which is worse than either end state.

## Consequence: declared, then enforced at configuration time

Once the declaration carries needs and fallbacks per connection, the check moves
earlier. A user enabling a command on a connection whose app cannot register
commands is refused **when they save**, not silently at 3am in a thread.

That is the second degradation rule: **loud at configuration, forgiving at
delivery.** Rendering stays total — it always produces something — while
configuration refuses what the connection provably cannot do.

## What this closes

- the credential schema gap, and with it provisioning having nowhere to live
- the contract suite hardcoded to one platform's credential names
- the per-connection half of the stateless-registration finding
- rendering having no answer for a surface without buttons
- the two app models being indistinguishable to core
