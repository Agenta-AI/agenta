# Provisioning a channel

The gap `F47` names. Nothing writes the credentials the adapters read, no channel
declares what it needs, and the Slack manifest builder has no callers.

Target surfaces in order: **Slack, Telegram, Discord**.

## What is the same, and what is not

Every channel needs the same *shape*: a set of credentials, validated, stored
encrypted, reachable by the adapter. Nothing else generalises. The ceremony by
which a credential is obtained differs per platform and cannot be abstracted:

| Platform | How the operator gets a credential | Our part |
| --- | --- | --- |
| Slack | create an app from a manifest, install it, copy two secrets | generate the manifest, take the secrets |
| Telegram | talk to BotFather, get one token | take the token, register the webhook |
| Discord | create an application, add a bot, set intents | take the token, register the endpoint |

So: **one declared schema, three flows.** The schema is code we share; the flow is a
per-platform page.

## 0. Two app models, not one

Revised after research: a comparable platform offers **both**, and declares the
difference rather than picking one.

| | Agenta-owned app | Customer-owned app |
| --- | --- | --- |
| setup | one click, OAuth install | create an app from a manifest, paste secrets |
| commands, modals, event subscriptions | **no** | yes |
| self-hosted | not possible | the only option |

The limitation is structural, not a product choice: **commands and event
subscriptions belong to the app, not to the installation**, and an app has one
manifest. So a shared Agenta-owned app cannot offer per-customer commands — every
installation would have to share one command set.

This is the same fact that forces the generated manifest below, seen from the other
side.

So the model is a property of the connection, it changes what the connection can
do, and the capability declaration has to say so — otherwise a user enables a
command on a managed connection and it silently never fires.

## 1. Each channel declares its credentials

Alongside the capability declaration, which today says only what a channel *can do*
and nothing about what it must be *given*.

Per field: the name, its **type**, whether it is secret, whether it is required,
and a label the UI can show. Type matters because text, OAuth and mTLS differ at
injection and at renewal — a token that expires needs a refresh path a static
secret does not. That is enough to generate the form, validate a save, and let the
contract suite build a valid connection for any adapter instead of for one.

This alone closes the three loose ends behind `F47`: six undocumented key names,
one pair admitted invented, and a contract suite hardcoded to one platform's field
names.

**Secrets are encrypted at rest and never returned by any read.** A configured
credential reads as "set", never as its value.

**And never persisted by accident.** The inbox and outbox store a `processed`
payload per event. A platform that echoes a token in a response would put it in our
log — a documented failure mode elsewhere, where the mitigation is asking the user
to trim their own output. Better to redact known credential fields on the way in
than to discover it later.

## 2. Slack's manifest is generated from the configuration

We do not have handlers to generate from — we have configuration. A user picks
agents and enables commands; the manifest follows from that.

Two consequences, and the second is the one that matters:

- Scopes and event subscriptions come from what is enabled, so a command cannot be
  enabled in our UI and absent from their Slack app.
- The manifest **changes when the configuration changes**, and the user's installed
  app does not change with it. So store the hash of the manifest last known to be
  installed, compare it to the current one, and show plainly when they differ.

Without that comparison this is exactly the defect where a handler is registered,
reports healthy, and never fires — with a user-facing face on it.

## 3. Verify, do not trust

A saved credential is unverified. Each channel gets a check that proves the
credential works: an auth test for Slack, a `getMe` for Telegram, a gateway
identify for Discord.

A connection is therefore **configured** and separately **verified**. Only a
verified connection is routable. This is what makes a misconfiguration visible at
setup instead of as a dead thread later.

## 4. The inbound URL is part of setup

Every one of the three needs to be told where to send events, and the URL depends
on the deployment, not on us. So the setup page shows the URL to paste, and the
readiness check is that a real event arrived on it — not that a field was filled.

## What this does not include

- **No hosted credential plane.** The comparable product keeps platform credentials
  in a service the operator does not run, so their runtime holds only a key and a
  name. We are keeping credentials in the connection. That is a deliberate
  difference, and it is why we need the schema and the flows — they get to skip
  both.
- **No OAuth-per-user.** The credential is the installation's, not the caller's.
  Identity linking is separate and already exists.

## Work packages

- **A — credential schema.** Declare it next to capabilities, with a type per
  field; generate the form from it; encrypt at rest; never read back; redact on
  ingest. Fixes the contract-suite hardcoding.
- **B0 — the two app models.** Agenta-owned install and customer-owned app, with
  the capability difference declared so an unavailable feature is refused at
  configuration time rather than silently dead.
- **B — Slack setup.** Manifest generated from configuration, installed-hash
  comparison and drift state, auth verification.
- **C — Telegram setup.** Token, webhook registration, `getMe` verification. The
  first channel that is not Slack, and therefore the real test of A.
- **D — Discord setup.** Application, bot token, intents, verification.

A blocks all three. B, C, D are independent of each other. C is worth doing
directly after B rather than last, because it is what proves the schema
generalises — with only Slack, A is indistinguishable from Slack's own fields.
