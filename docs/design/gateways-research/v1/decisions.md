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

## D3. The gateways hold no secret material

A domain row carries a secret id; the secrets service holds the value; the consumer resolves
it at use time. This is the pattern webhook subscriptions and SSO providers already use.

**Why it matters beyond tidiness:** encryption, key management, rotation and deletion stay in
one place instead of gaining a second. It also removes what looked like the design's one new
component — there is no token store, only new secret kinds (D14).

This is about *secrets* — customer provider material. The credential that authenticates a
caller into a gateway is a different thing and is not stored at all (D13).

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

Four efforts specify an LLM gateway (`raw/related-work.md`). **This one owns the gateway
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

## D13. The inbound credential is minted, ephemeral, and never stored

The credential that authenticates a caller **into** a gateway is not a new kind of thing and
does not live in the vault. By the established vocabulary it is a *credential* — Agenta's own
auth — not a *secret*, which is customer provider material.

**It is minted per use and expires, and the mechanism already exists.** `sign_secret_token`
produces an HS256 JWT carrying the user, project, workspace and organization plus an expiry,
currently 15 minutes. It travels as `Secret <token>`, one of three accepted authorization
schemes beside `Bearer` and `ApiKey`, and the middleware verifies it by decode alone — no
database read. The access router re-mints one on every permission check rather than echoing an
API key, and **the workflow invoke prelude already signs one per run** for batch and detached
invokes, centralised so the two paths cannot drift on auth. The gateways use that signer.

**One token per target, minted in a batch.** A run reaching three MCP servers gets three
tokens in one minting call, each valid for one target. A leaked token then reaches one server,
not the whole gateway. The wire already carries per-server credentials, so nothing new is
needed to deliver them.

**Why ephemeral beats a durable scoped key.** There is nothing at rest to steal, nothing to
rotate, no revocation path to build, and no new secret kind. Expiry is the revocation. A
durable per-endpoint key would be better than passing the user's own API key, and worse than
this.

**Why not the user's own API key.** It carries everything that user can do, it cannot be
rotated without breaking their other integrations, and it would sit inside an agent-controlled
sandbox.

**One gateway-wide token, unchanged, for now.** The existing secret token is enough: a caller
presents it and the gateway authorises per call through the normal permission path. No target
claim, no permitted set, no new claims.

Per-endpoint tokens and a permitted set in the payload are a **later** step, arriving with
user-owned secrets. The grain then goes project, then user, then endpoint — finer at each step.
Batch minting is an optimisation and not part of any of this.

The cost of the simple version is a permission lookup per call rather than a signature check.
That is what the rest of the API already does, and it keeps a revoked permission effective
immediately rather than at the next mint.

**The known failure mode.** Per-turn credential material must stay out of any session
fingerprint that decides whether a warm session may be reused. The runner already excludes its
tool-callback bearer from the credential epoch for this reason, and a regression that folded
per-turn material into that hash has already been fixed once. Gateway tokens are the same kind
of material and inherit the same rule.

## D14. Two OAuth secret kinds, and no static MCP kind

**`oauth_provider`** holds our client registration with an authorization server. The existing
SSO kind is the precedent in both name and shape — it already stores a client id, a client
secret, an issuer URL and scopes.

**`oauth_grant`** holds a user's tokens: access, refresh, expiry, granted scopes, and the
server the token was minted for.

**Two kinds, not sub-kinds of one.** The sub-kind pattern in this codebase discriminates the
*same thing across vendors* — a provider key has one shape and one lifecycle whether it is
OpenAI or Anthropic. These two share no fields, and they differ in cardinality (one per
authorization server versus one per user per server), in lifetime, in rotation frequency, and
in owner. A single kind would need a union inside it, and every query for a user's grants would
filter on an inner field instead of on the kind.

**No new kind for static MCP credentials in this scope.** Under D15 the targets are Agenta's own
MCP gateway and OAuth-protected servers. A third-party server authenticating with a static token
would need one, and that is deferred rather than designed away.

**Never overload an existing kind.** The general-purpose custom secret and custom provider kinds
exist for other things. Coordinate with the parallel bring-your-own-secrets work, which is adding
kinds to this same enum for sandbox providers and the tool gateway key.

## D15. Current scope is the gateways, agent v0, the runner, and the harnesses

No other service changes yet. The evaluator path — including the two callers that use embeddings
rather than chat — comes later, and so does the question of whether embeddings share the model
registry.

D1 remains the target. This is where it starts.

## D16. One URL per MCP server, namespaced identifier, pass-through

Each registered server gets its own gateway URL. The identifier in that URL carries a namespace,
because a bare name identifies nothing once there are Composio-backed servers, Agenta-internal
ones, built-ins, and user-defined custom ones — some per-user, some project-wide. It is an id or
a slug, never a display name.

Because the server is already distinguished by its URL, **tool names are not touched**. The
gateway is a transparent proxy per server, not a wrapper: same tool names, same schemas, same
errors, same list responses. It changes the route and the credential and nothing else the agent
can observe.

A merged endpoint with namespaced tool names was rejected. It would rename what the model sees,
tie the tool list to credential health, and fight the list caching the protocol now encourages.

## D17. Step-up scopes are an interaction, not a failure

Two halves, both needed.

**At connect time the user selects scopes.** Not a blanket request for everything the server
advertises — offer the set and let them choose.

**At step-up the gateway raises an interaction.** When a call needs a permission that was never
granted, this is the same situation as a tool needing a connection that does not exist yet, and
that path already exists: an interaction and a connect affordance rather than a failure. Step-up
reuses it, asking for additional permissions on an existing connection.

Failing with a clear error was rejected: it is the same situation as a missing connection, where
we already do not fail.

## D18. A dead secret does not hide tools

When a secret is revoked or cannot refresh, the server's tools stay listed and the call fails.
The existing escalation and interaction paths let the user reconnect.

Hiding tools was rejected because it changes what the agent can do without telling anyone.
Anything beyond this is a question about the interface, which this design does not settle.

## D19. A gateway endpoint is a server, not a model or a tool

An LLM gateway endpoint is a **provider**, which may serve many models. An MCP gateway endpoint
is a **server**, which may serve many tools. The two gateways are symmetric.

This is why a per-model endpoint is wrong: it would make the LLM gateway asymmetric with the MCP
one and multiply endpoints by the size of a provider's catalogue.

## D20. Standard endpoints are generated; only custom ones are stored

Everything needed to reach a standard provider is deterministic. The provider-to-models
catalogue already lives in the SDK as a static map — eleven providers, each with its model list,
with costs derived from the routing library. So a standard endpoint's route is derivable rather
than persisted: a stable prefix, the standard marker, and the provider's own name. No slug,
because the provider name is the identifier.

**The CRUD surface therefore stores only custom endpoints.** A standard endpoint exists when a
key exists for it. The same split applies to MCP: built-in servers are ours to define, custom
ones are rows.

## D21. Configuration is per endpoint, and only custom endpoints are configurable

Timeouts, ceilings and extra headers are one concern, not three, and they apply to both
gateways.

**Editability follows the same split as D20.** Standard and built-in endpoints are ours to
define; users do not edit them. The configuration surface exists for **custom** endpoints on
both gateways.

Configuration lives **per endpoint**. A per-provider-kind layer may earn its place as a static
default; a global layer does not. Each additional layer needs somewhere to live and a precedence
rule, so add them only when something needs them.

## D22. The audit record is an event, not a new table

An events domain already exists across core, API, storage and an asynchronous worker. Its event
type carries a request id and event id, a request type and event type, a timestamp, a status
code and message, and a free-form attributes map, with a query surface beside it.

The gateways emit into that. They do not add a second event pipeline or an audit table.

## D23. The gateways must be mockable, and the fakes come first

Nothing behind either gateway can be a third-party dependency in tests. A fake LLM endpoint and
a fake MCP server are **first-class deliverables of the first checkpoint**, not test scaffolding
added afterwards.

This is also what makes the first checkpoint coherent: with no OAuth and no static secret kind
in it, the only reachable targets are our own servers and the fakes. That is a complete target
set rather than a gap.

## D24. The legacy credits counter is left alone

A credits counter is incremented today when a caller checks access to platform-owned secrets.
It is legacy. It is not moved, not reinterpreted, and not fixed as part of this work.

It is removed only once the gateway is the sole mechanism the whole system uses.

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
