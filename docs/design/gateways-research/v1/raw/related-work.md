# Related work: who else is designing this gateway

Four efforts include a model gateway. Three of them were written independently of this one.
This document maps them, so the design stops colliding and starts converging.

**Metering and billing stay a follow-up here.** They are the reason three of these efforts
exist, and they are not this design's subject. What matters below is the part that constrains
the gateway itself.

## The four

| Effort | Where | Gateway scope |
|---|---|---|
| This design | `gateways-research` | models **and** MCP, every caller, every provider |
| Credits and the model gateway | a separate private repo | models only, the funded path |
| Activation credits | `docs/activation-credits-proposal` | models only, one model, the trial path |
| Bring-your-own secrets | `feat/metering-track-d` | secrets and their origin, not a request path |

The first three all specify a request path for model calls. Only this one covers MCP.

## What the credits design settles better than this one

Read `model-call-sites.md` first for the library question; this is the rest.

- **The run token is the cached policy decision.** A short-lived signed token whose claims
  name the organization, project, run, permitted model, a token ceiling and a spend cap. The
  gateway checks signature and expiry and reads no database. This design left that mechanism
  open.
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

## The one real conflict

**Scope.** The credits gateway and the activation gateway both cover the *funded* path — our
money, one model, one provider — and the SDK returns a gateway route only when a run is
funded. This design's D1 says everything transits, always.

Both cannot hold. If a funded-only gateway ships as written, D1 is false and the governance
claims do not follow from it.

This is a decision, not a defect. The question: **is the gateway a spend-control mechanism, or
a governance boundary?** It can become both. The first version's scope decides which claims we
may make, and when.

The mechanism is identical either way — the same token, the same endpoint, the same credential
swap. Only the trigger differs: funded runs only, or all runs. That makes convergence cheap if
it is decided now and expensive if it is decided after one of them ships.

## Recommendation

One gateway, two protocol surfaces, per decision D7. The credits ledger and the trial grant
become consumers of it rather than parallel systems. This design contributes MCP, the secret
model, and the transit rule; the credits design contributes the hot path, which is further
along and more concrete.

Metering and billing then follow, on top of a gateway that already exists.
