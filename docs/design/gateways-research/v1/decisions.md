# Gateways: decisions

What is settled, and the rationale load-bearing enough to constrain future work. Everything
else in `v1/` assumes these and states only what is.

Where another document elaborates a decision, that document
is the authority for detail; this one owns the rationale.

---

## D1. Everything transits a gateway

No direct path and no bypass. Every model call and every tool call from anything on the
platform goes to a gateway first, and the gateway decides what happens next.

This includes everything custom. A custom provider, a self-hosted model server, a cloud
reseller, an OpenAI-compatible third party — none becomes an exception. The call goes to our
gateway and the gateway's adapter calls the custom thing. **What is custom lives behind the
gateway; the route to it is invariant.**

**Why absolute:** a governance boundary with an exception is not a boundary. If any path
reaches a provider directly, no claim about policy, audit, spend or credential containment
holds — "did every call get checked" becomes "every call except those." One bypass costs the
whole property.

**What it costs:** changes throughout, not in one place. Every call site that resolves a
credential and calls a provider becomes one that calls the gateway. That is the real scope
and should not be understated.

## D2. The principal already exists and is user-scoped

Every authenticated call resolves an organization, workspace, project and user together, and
is rejected if any is missing. API keys included — the key row carries its owning user.

The gateways inherit this. **There is no principal to design.** Which credential the gateway
then uses on the caller's behalf is a separate binding, settled in `secrets.md`; caller
identity and credential ownership are independent, and conflating them is what made this look
harder than it is.

## D3. The gateways hold no credential material

A domain row carries a secret id; the secrets service holds the value; the consumer resolves
it at use time. This is the pattern webhook subscriptions and SSO providers already use.

**Why it matters beyond tidiness:** encryption, key management, rotation and deletion stay in
one place instead of gaining a second. It also removes what looked like the design's one new
component — there is no token store, only new secret kinds.

## D4. Ports and adapters everywhere, including inside the SDK

The SDK keeps every capability it has today, including injecting and fetching secrets. Those
are not removed and calling code does not change shape. What changes is the implementation
behind the port: the adapter that resolved a credential and called a provider now calls the
gateway.

Nothing here is "in-process." A caller depends on a port; the adapter behind it talks to the
gateway.

## D5. Agent runs and workflows are separate callers

Different callers of the same gateway, with different ports, designed separately. Reasoning
about them as one path produces conclusions wrong for both.

## D6. Transparent on the data path, never on the consent path

The gateway absorbs credential selection, injection, refresh, retry, allowlists and audit. It
cannot absorb consent, which needs a human at first use and again on a step-up scope
challenge. No amount of internal configuration changes that.

**Consequence:** consent is a dashboard action taken before a run, not a runtime one. A run
reaching an unconnected upstream fails with something actionable. Every remaining choice in
this area is about *where the consent moment goes*, not whether there is one.

## D7. One policy core, two protocol surfaces

The six concerns are the same over different nouns, and building the plane twice is the
failure this design exists to avoid. Whether it ships as one deployable or two is an
operational choice that can follow.

**This decision is falsifiable and should be watched.** If `policy.md` ends up as two
documents with little in common, D7 is wrong and the gateways should be separate systems.

## D8. Target the stateless protocol revision

The current MCP revision removed exactly the features that made a gateway expensive —
sessions, resumability, server-initiated callbacks — and added three that favour
intermediaries. Build against it rather than the prior revision the earlier research assumed.

## D9. Embed the commodity, own the policy

Provider adapters, streaming differences, reseller auth schemes and the MCP OAuth client flow
are commodity work that drifts constantly and is freely available. Identity, policy, audit and
metering are ours and no embedded gateway will model them the way we need.

Owning the wrong half is the expensive mistake in either direction.

## D10. Take the credential owner as a parameter now

User-level credentials are designed and not scheduled. The lookup must still take the owner
from the outset and answer "the project" for now.

**Why now:** the signature is the expensive part to retrofit. A lookup assuming the project
spreads that assumption to every call site; a lookup taking an owner absorbs user-level
credentials as a storage change. The caller side needs nothing either way, since the principal
already carries the user.

## D11. This design owns the gateway

Four efforts specify a model gateway (`raw/related-work.md`). **This one owns the gateway
design.** The others are inputs to it and consumers of it, not parallel designs.

Concretely: the credits ledger and the trial grant are **callers** of the gateway. They decide
what a run may spend. They do not decide what the gateway is, nor does either ship a second
request path.

**Why one owner:** the mechanism in all four is identical — the same signed run token, the same
endpoint, the same secret swap at the boundary. Only the trigger differs. Four owners of one
mechanism produces four subtly different versions of it, and the boundary claims then hold for
none of them.

Work already done elsewhere is adopted rather than repeated. The run token, the north port
shape, and the process placement all come from the credits design and are better than what this
document had (D2's open mechanism, in particular).

## D12. The gateway owns all six concerns, delivered incrementally

The gateway owns identity and permissions, governance, secrets, and metering and billing.
Not a subset.

**This settles the scope conflict** in `raw/related-work.md`. Two parallel efforts scope the
gateway to funded runs only. That is a **delivery phase, not the design**. D1 stands: the target
is that everything transits, and a funded-only first version is a step toward it rather than a
different destination.

**Incrementally means the concerns arrive in an order, not that any is out of scope.** A
concern may be unimplemented; none may be designed out. The test for each increment is whether
it forecloses a later one — the credential lookup taking an owner from the outset (D10) is the
pattern, and recording real usage from the first day even when charging a flat price is the
same move on the billing side.

**What this rules out:** a second request path for any concern. If billing needs something the
gateway does not expose, the gateway grows it. Billing does not route around it.

---

## Still open

Tracked in [`open-designs.md`](open-designs.md) until they settle here. Two earlier blockers
are now closed — the model call sites are counted and the routing library runs in-process
(`raw/model-call-sites.md`).

What remains:

- The MCP endpoint shape: one merged endpoint with namespaced tools, or one per server.
- Step-up scope handling.
- Whether embeddings share the model registry and resolution path, or need their own.
- The order the concerns arrive in, under D12.
