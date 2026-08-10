# Which connection does an inbound event belong to?

> **Superseded in part by `channel-connections.md`.** The platform research below
> stands and is what the design was built from. The conclusion it reaches — *"the key
> is the bot, and the tenant is a qualifier"* — is **wrong**, and the "Still open"
> questions are now answered. Both are corrected at the bottom of this file.

The one query that cannot be project-scoped, because its job is to **establish** the
project. Everything after it is scoped by what it returned. So the key it resolves on
must be globally unique and must resolve to exactly one connection.

Today it is neither. `integration_key` holds Slack's `team_id`, which identifies the
**workspace**, not the bot — so two bots in one workspace collide and `LIMIT 1`
silently picks one.

## What each platform actually puts on the wire

Checked against the platforms' own documentation, and one result breaks the model.

| Platform | Identifies the bot | Identifies the tenant | On every payload? |
| --- | --- | --- | --- |
| Slack | `api_app_id` | `team_id`, or nested `team.id` | yes, but two shapes |
| Discord | `application_id` | `guild_id` | `application_id` yes; `guild_id` absent in DMs |
| Telegram | **nothing** | **nothing** | — |
| Teams | `recipient.id` by convention | `conversation.tenantId` | unverified |

Three consequences, in order of how much they cost us.

### Telegram carries no bot identity at all

Confirmed against the `Update` object's full field list: there is no bot field, and
none of the update variants carry one. The bot is identified **by the transport** —
the webhook URL was registered with that bot's token.

So the model "extract the key from the payload" does not hold for Telegram, and it
is not an edge case we can defer: it is the second channel we plan to ship.

The mechanism Telegram gives us is `setWebhook`'s `secret_token`, echoed back on
every request as `X-Telegram-Bot-Api-Secret-Token`. That is per-bot, chosen by us,
and present on every update. A distinct URL path per bot is the other option and
they compose.

**This changes an interface.** `installation_hint(body)` takes only the body, so an
adapter that needs a header or the path literally cannot answer. It must take the
whole request context — headers and path as well as body. Cheap now, since the
method is one wave old and has three implementations.

Note what the secret token also does: it is a shared secret on every request, which
for Telegram doubles as the signature. Telegram has no HMAC. So for that adapter,
resolving the connection and verifying it are the same act — which is exactly what
the ingress already assumes.

### Slack has two payload shapes, and an Enterprise Grid case

`team_id` is flat on the Events API and slash commands; `team` is a nested object on
interactivity payloads. An extractor reading only `team_id` returns nothing for a
button click — which is precisely the path we have not built yet, so this would have
bitten on first contact.

Worse, org-wide installs on Enterprise Grid span **many** `team_id`s under one
`enterprise_id`, and Slack's own guidance is to treat `enterprise_id` as the source
of truth there. Keying strictly on `team_id` fragments one logical installation into
many connections.

### Discord has no tenant for DMs

`application_id` is always present; `guild_id` is absent in a DM. So a key of
`(application_id, guild_id)` is undefined exactly when someone messages the bot
directly.

## What follows

**The key is the bot, and the tenant is a qualifier — not the reverse.** In every
case the bot identifier is the stable, always-present half; the tenant half is
sometimes absent (Discord DMs), sometimes plural (Enterprise Grid), sometimes
missing entirely (Telegram).

So:

- **A connection is one bot.** The key identifies the bot. `slug` is not part of the
  identity — two rows differing only by slug are two names for one bot, which is
  what `LIMIT 1` cannot resolve.
- **The key must be globally unique**, not unique per project. Today's constraint is
  `(project_id, provider_key, integration_key, slug)`, which permits two projects to
  register the same key and lets one tenant's event resolve against another's
  connection.
- **The adapter composes its own key**, because no universal pair exists. Slack
  composes from `api_app_id` plus workspace-or-enterprise; Discord from
  `application_id`; Telegram from a secret we minted. Core does not know the shape
  and must not.
- **Resolution reads the whole request, not the body.** Header, path and body. This
  is the interface change Telegram forces and Slack's two shapes reward.

## Correction: the rule above is wrong

*"The key is the bot, and the tenant is a qualifier"* does not hold. It fails at
both ends of the range it was meant to cover:

- **Enterprise Grid has no single tenant to qualify with.** An org-wide install is
  one installation with one token spanning many `team_id`s, so there is no tenant
  value to attach.
- **The bridge has no bot.** A bridge fronts a platform we never see. "Bot" was a
  Slack shape generalised into a rule, and our own contract already said so.

It was also right for the wrong reason. The useful observation was never
*bot-versus-tenant*; it was *always-present versus sometimes-absent*.

What replaces it: **core does not know what identifies a connection — the adapter
declares it and one function composes it**, exactly as `SPACE` and `THREAD` already
work. `channel-connections.md` carries the design.

## The open questions, now answered

- **Enterprise Grid**: an org-wide install is **one** connection — installed once at
  the org level, one token, marked `is_enterprise_install: true`. The finding that
  changed the schema is that both models **coexist**: the same app can have an
  org-wide install *and* per-workspace installs in the same org, each with its own
  token. So `team_id` cannot be in the identity, and the discriminator is
  `enterprise_id` when the install is org-wide and `team_id` when it is not.
- **Installing the same app twice into one workspace**: not supported — separate
  installations require separate apps, with distinct `api_app_id`s. So two bots in
  one workspace are two apps, and `api_app_id` is what separates them.
- **Teams' bot-identity convention** remains community-sourced and unconfirmed.
  Verify before building — the Enterprise Grid result is what happens when a
  plausible model meets the documentation.
