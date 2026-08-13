# Related work: who else is designing this gateway

Four efforts include an LLM gateway. Three of them were written independently of this one.
This document maps them, so the design stops colliding and starts converging.

Ownership and scope are now settled — see the last two sections, and D11 and D12. Metering and
billing are **owned by the gateway and delivered later**, which is not the same as being out of
scope.

## The four

| Effort | Where | Gateway scope |
|---|---|---|
| This design | `gateways-research` | models **and** MCP, every caller, every provider |
| Credits and the LLM gateway | a separate private repo | models only, the funded path |
| Activation credits | `docs/activation-credits-proposal` | models only, one model, the trial path |
| Bring-your-own secrets | `feat/metering-track-d` | secrets and their origin, not a request path |

The first three all specify a request path for model calls. Only this one covers MCP.

## What the credits design settles better than this one

Read `model-call-sites.md` first for the library question; this is the rest.

- **The run token is the cached policy decision.** It names the organization, project, run,
  permitted model, a token ceiling and a spend cap. This design left that mechanism open.

  **Correction — this entry cited the wrong shape.** It previously described a *signed token
  carrying its own claims*, verified without a database read. That is the credits work's
  **proposal A**, which its own report considered and rejected. Its decision (§6.2, item 1) is
  the opposite: *"Take B"* — an opaque random string whose digest is stored, so the gateway
  reads a row per call. The reasoning is that statelessness saves a round trip the design never
  banks, because *"every model call already needs a Postgres transaction in order to place a
  hold"*, and it is paid for *"in the currency of revocation"* — the row can be revoked the
  moment a run ends, a user cancels, or an organization is suspended, and it is also the natural
  home for the per-run cap.

  Whichever wave designs the funded-run token should resolve it against that argument, not
  against the discarded proposal. Note the two shapes differ on where the constraint lives, not
  on whether it exists: the permitted model and the ceilings are in a **row** keyed by the token
  digest, which is not the payload claim set D13 declines to add.
- **The north port shape.** One endpoint, the body byte for byte, all metadata in the URL or a
  header. It agrees with the header-based routing the current MCP revision requires, so both
  planes route the same way.
- **Where it runs.** Its own process, from the same image and codebase, beside the existing
  entrypoints — own worker count, own stream timeouts, and a shared codebase so two writes
  commit in one local transaction. An internal HTTP hop between gateway and API is rejected on
  the grounds that it adds a network dependency to every stream.

## What the activation-credits design adds

Its floor version names the gateway as **the one piece that cannot be stripped**, and gives the
reason plainly: the sandbox is user-controlled, so a raw platform secret inside it is
stealable, and no counter anywhere else fixes that.

That is the same security argument this design makes, reached independently.

## What the BYOS track changes here

This one touches the credential model directly, and it is further along than this design.

**Vocabulary, which this design got wrong.** The established rule: a customer's provider key
is a **secret**. The word **credentials** is reserved for Agenta's own auth — API keys, secret
tokens, access tokens. This design used "credential" for upstream provider material
throughout. The other usage is already in the tree, so this design should move.

**`secret_origin: vault | local`** stamps whether a secret is the customer's or the platform's.
It is a third axis beside auth scheme and owner, and it is the same fact this design called
the *payer* in the resolution result. Their name is implemented; adopt it.

**New secret kinds for sandbox providers and the gateway provider key**, in the same encrypted
table. This design proposed the same move for MCP. The kinds should be designed together
rather than twice.

**A prerequisite this design missed.** Their task D0 records that the secrets read surface
returns plaintext material to any caller holding the view permission, and that the agent path
resolves straight through it and bypasses the gates. Everything here assumes resolution goes
through the secrets service safely. **It does not today.** See `open-reviews.md` OR14.

## The scope question — settled

Two of the four scope the gateway to the *funded* path, and return a gateway route only when a
run is funded. This design's D1 says everything transits, always.

**Settled by D12: funded-only is a delivery phase, not the design.** The target stays "all
calls transit". A funded-first version is a step toward it, not a different destination.

The mechanism was never in conflict — the same run token, the same endpoint, the same
secret swap. Only the trigger differed.

## Ownership — settled

**This design owns the gateway (D11).** The others are inputs to it and consumers of it.

The credits ledger and the trial grant are **callers**. They decide what a run may spend. They
do not define the gateway, and neither ships a second request path. Under D12 the gateway owns
identity and permissions, governance, secrets, and metering and billing — so a billing need is
met by the gateway growing, never by billing routing around it.

What each effort contributes:

- **This one** — MCP, the secret model, the transit rule, and the concern set.
- **The credits design** — the hot path: the run token, the endpoint shape, the process
  placement. Further along and more concrete than what this document had.
- **Activation credits** — the argument that the gateway is the unstrippable piece, and the
  trial-path requirements.
- **BYOS** — the vocabulary, `secret_origin`, the sandbox and gateway secret kinds, and the
  read-surface prerequisite.

Metering and billing then arrive incrementally, on a gateway that already exists.
