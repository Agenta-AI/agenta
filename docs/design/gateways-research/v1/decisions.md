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
reaches a provider directly, no claim about policy, audit, spend or secret containment
holds — "did every call get checked" becomes "every call except those." One bypass costs the
whole property.

**What it costs:** changes throughout, not in one place. Every call site that resolves a
secret and calls a provider becomes one that calls the gateway. That is the real scope
and should not be understated.

## D2. The principal already exists and is user-scoped

Every authenticated call resolves an organization, workspace, project and user together, and
is rejected if any is missing. API keys included — the key row carries its owning user.

The gateways inherit this. **There is no principal to design.** Which secret the gateway
then uses on the caller's behalf is a separate binding, settled in `secrets.md`; caller
identity and secret ownership are independent, and conflating them is what made this look
harder than it is.

## D3. The gateways hold no secret material

A domain row carries a secret id; the secrets service holds the value; the consumer resolves
it at use time. This is the pattern webhook subscriptions and SSO providers already use.

**Why it matters beyond tidiness:** encryption, key management, rotation and deletion stay in
one place instead of gaining a second. It also removes what looked like the design's one new
component — there is no token store, only new secret kinds (D14).

This is about *secrets* — customer provider material. The credentials that authenticate a
caller into a gateway are a different thing and are not stored at all (D13).

## D4. Ports and adapters everywhere, including inside the SDK

The SDK keeps every capability it has today, including injecting and fetching secrets. Those
are not removed and calling code does not change shape. What changes is the implementation
behind the port: the adapter that resolved a secret and called a provider now calls the
gateway.

Nothing here is "in-process." A caller depends on a port; the adapter behind it talks to the
gateway.

## D5. Agent runs and workflows are separate callers

Different callers of the same gateway, with different ports, designed separately. Reasoning
about them as one path produces conclusions wrong for both.

## D6. Transparent on the data path, never on the consent path

The gateway absorbs secret selection, injection, refresh, retry, allowlists and audit. It
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

## D10. Take the secret owner as a parameter now

User-level secrets are designed and not scheduled. The lookup must still take the owner
from the outset and answer "the project" for now.

**Why now:** the signature is the expensive part to retrofit. A lookup assuming the project
spreads that assumption to every call site; a lookup taking an owner absorbs user-level
secrets as a storage change. The caller side needs nothing either way, since the principal
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
it forecloses a later one — the secret lookup taking an owner from the outset (D10) is the
pattern, and recording real usage from the first day even when charging a flat price is the
same move on the billing side.

**What this rules out:** a second request path for any concern. If billing needs something the
gateway does not expose, the gateway grows it. Billing does not route around it.

## D13. The inbound credentials are minted, ephemeral, and never stored

The credentials that authenticate a caller **into** a gateway are not a new kind of thing and
do not live in the vault. By the established vocabulary they are *credentials* — Agenta's own
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

**The known failure mode.** Per-turn secret material must stay out of any session
fingerprint that decides whether a warm session may be reused. The runner already excludes its
tool-callback bearer from the secret epoch for this reason, and a regression that folded
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

**No new kind for static MCP secrets in this scope.** Under D15 the targets are Agenta's own
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
errors, same list responses. It changes the route and the secret and nothing else the agent
can observe.

A merged endpoint with namespaced tool names was rejected. It would rename what the model sees,
tie the tool list to secret health, and fight the list caching the protocol now encourages.

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
than persisted: a stable prefix, the `builtin` namespace, and the provider's own name. No slug,
because the provider name is the identifier.

**The URL spells that namespace `builtin`, not `standard`** (D27). The secrets domain's word for a
non-custom provider is *standard*; the path segment is `builtin` on both planes; the mapping
between them lives in one place. A public path segment does not owe its spelling to an internal
enum.

**The CRUD surface therefore stores only custom endpoints.** A standard endpoint exists when a
key exists for it. The same split applies to the tool plane: `agenta` and `builtin` servers are
ours to define or broker, and only `custom` ones are rows.

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

## D23. The gateways must be mockable, and the mocks come first

Nothing behind either gateway can be a third-party dependency in tests. A mock LLM endpoint and
a mock MCP server are **first-class deliverables of the first checkpoint**, not test scaffolding
added afterwards.

This is also what makes the first checkpoint coherent: with no OAuth and no static secret kind
in it, the only reachable targets are our own servers and the mocks. That is a complete target
set rather than a gap.

## D24. The legacy credits counter is left alone

A credits counter is incremented today when a caller checks access to platform-owned secrets.
It is legacy. It is not moved, not reinterpreted, and not fixed as part of this work.

It is removed only once the gateway is the sole mechanism the whole system uses.

## D27. Three namespaces on both planes — and the namespace picks the backend

**SUPERSEDED IN PART BY D30**, which replaces the set with `builtin` / `standard` / `custom`
and demotes `agenta` to a provider inside `builtin`. What survives here: the spelling rule,
the reserve-all-three rule, and the backend-selection table below.

**Spelled without a hyphen.** The namespace is a path segment in every gateway URL, so it stays
one lowercase word: `builtin`, never `built-in`.

**The same three words on both planes**, and all three are reserved from the start even where one
has no members yet. Taking a keyword costs nothing now; discovering later that something else took
it costs a migration of live URLs.

| Namespace | LLM plane | MCP plane |
|---|---|---|
| `agenta` | **Reserved, empty today.** Where an Agenta-owned or fine-tuned model would live | The Agenta tools. The mocks are its first members (D23) |
| `builtin` | The generated standard-provider set (D20) | Third-party servers shipped ready to click, backed by the Composio catalog the integrations domain already consumes |
| `custom` | A stored endpoint row: a customer's own deployment or reseller | A stored endpoint row: a server the user brought by URL |

**`builtin` aliases the standard-provider path internally, and that is fine.** The secrets domain
calls a non-custom provider *standard*, and the URL says `builtin`. The gateway maps one to the
other in one place. **A public path segment does not owe its spelling to an internal enum** — the
alternative was two vocabularies for one idea, split across the two planes, purely to avoid a
two-line mapping.

**The runner's loopback channel is not in this picture.** It is a loopback — a per-run transport
that hands first-party tools to a harness — and it stays exactly that. The exclusion in `notes.md`
holds. The Agenta tools are the Agenta tools; how a particular run happens to receive them is a
separate concern and always was.

### The namespace selects the backend

That is what makes it worth being in the path rather than in a column.

| Hit | The gateway calls |
|---|---|
| `agenta` | The Agenta tools |
| `builtin` | Composio, reusing the connection the integrations domain already brokered |
| `custom` | The upstream the endpoint row names, with the secret we resolved for it |

### The route grammar

```text
/gateways/mcps/builtin/agenta/{slug}                                  agenta/tools
/gateways/mcps/builtin/{provider}/{integration}/{connection}  builtin/composio/notion/my-notion
/gateways/mcps/custom/{slug}                                  custom/acme-notion

/gateways/llms/agenta/{slug}                                  reserved, empty today
/gateways/llms/standard/{provider}                             builtin/openai
/gateways/llms/custom/{slug}                                  custom/acme-azure
```

**The words are the ones the codebase already uses.** `provider`, `integration` and `connection`
are `provider_key`, `integration_key` and the connection's slug — the three columns of the
existing connection table's unique key, `(project_id, provider_key, integration_key, slug)`,
minus the project, which comes from the token. Naming them anything else would invent a second
vocabulary for one set of values.

**Identifiers are slugs or keys, never display names.** An `agenta` identifier is a slug we own
and **may be nested**, so its route segment is a path rather than a single component. A `custom`
identifier is one slug, unique within the project.

**The model plane's version segment is not part of this grammar.** `/v1` belongs to the upstream
protocol's own path — an OpenAI-compatible client appends `/v1/chat/completions` to whatever base
it is handed, which is why the existing endpoint map in the SDK stores
`https://api.openai.com/v1` for OpenAI and a bare host for Anthropic. We hand out a base ending
`/v1` for the same reason. **The tool plane has no equivalent**, because the whole MCP protocol is
a POST to the endpoint URL itself with no path structure after it, and the protocol revision is
negotiated in a header rather than a path.

So there is no `/v1` on a tool endpoint. Versioning *our own* surface is a separate question, it
applies to the whole API rather than to one plane, and no route in this codebase carries a
version segment today. `contract.md` keeps it open.

**The broker is named in the path, and that is deliberate.** An earlier draft hid it behind a
stable name so a provider swap would not change URLs. That is the wrong instinct twice over. The
provider is part of a connection's identity rather than an implementation detail — the existing
connection table already keys on `(project, provider_key, integration_key, slug)` — and two
connections to the same vendor through different brokers carry different secrets, different
consent and different tokens. A URL that survived a backend swap would keep resolving while the
user's tokens did not migrate, which hides a real breakage instead of showing it. Naming the
broker also lets a brokered server and a direct one to the same vendor coexist.

The in-tree precedent agrees: the tool call reference is
`tools.{provider}.{integration}.{action}.{connection}`, and the catalog routes are
`/catalog/providers/{provider_key}/integrations/{integration_key}`.

**The extra segment on the tool plane is real structure, not an inconsistency.** On the model
plane the provider *is* the server, so nothing follows it. A broker is not a server; it fronts
many, so the one being addressed has to be named. That is D19 applied honestly to a broker.

**The rule an interim draft added does not survive, and it is worth saying why.** That draft kept
the broker's integration key in a field we mapped through, so their rename would be a mapping
change rather than a broken URL. The final grammar puts their key in the path instead, and the two
cannot both hold.

The path wins for the same reason the broker is named there at all: if a broker renames an
integration, that is a real change to what a stored URL points at, and a URL that quietly kept
resolving would hide it. Vendor integration keys are stable in practice, and the cost of the rare
rename is a visible break rather than a silent one.

### Why `builtin` is Composio-backed

A dashboard user clicks *Notion*. They do not type Notion's URL. So something must already hold
the display name, the icon, the description and the URL — and that something is a catalog we
would otherwise curate by hand, forever, per server.

**We already consume one.** The catalog contract in the existing integrations domain carries the
key, name, description, categories, **logo**, url and auth schemes for the whole Composio
integration set, and Composio hosts MCP endpoints with the secret lifecycle on their side.
The connection state machine and the connect affordance are in the tree and already drive the
tool domain. Nothing new is curated and nothing new is maintained.

**What is deliberately not stored, and this is what keeps the catalog small.** Not the OAuth
endpoints, and not even the scope list. Given the server's URL, both are fetched at configuration
time with no secret at all: an unauthenticated call returns a challenge naming the
protected-resource metadata, that names the authorization server, and the authorization server
publishes its endpoints together with the scopes it supports. So the dashboard renders real scope
checkboxes from a live call rather than from a stored field, which is what connect-time scope
selection requires (D17).

**The catalog is therefore five fields:** name, icon, description or category, and URL.

### `builtin` reuses the brokered connection; `custom` runs our own flow

The two are different mechanisms, not two configurations of one.

**`builtin`** rides what already exists. The integrations domain brokers the authorization,
stores the connection row, and holds the secret upstream; the MCP endpoint references that
row and the gateway relays to Composio's endpoint. There is no OAuth client of ours in the path,
no grant row, and no new secret. What still needs designing is the reference itself — which row,
keyed how, and what happens to the endpoint when the connection is revoked.

**`custom`** is the full journey and the only reason our OAuth client exists. The user supplies a
URL; the gateway discovers the authorization server from the server itself; our client runs the
authorization with proof key exchange; the tokens land in the vault as an `oauth_grant` secret
(D14) with the grant row pointing at it; and a later call resolves that secret and resumes. This
is the path that exercises everything the OAuth wave builds.

### The cost of this, stated plainly

With `builtin` meaning only Composio, our own OAuth client is exercised only by `custom` servers,
and "everything transits our gateway" becomes "everything transits our gateway, which transits
theirs." We own the policy, the audit and the identity; we do not own the vendor relationship.

That is a reasonable place to start and a poor place to stay. Whether a small set of **direct**
built-in servers exists from the beginning is open — `open-designs.md` OD13 carries it, along with
the maintenance pattern this repo already uses for a comparable catalog.

## D26. The OAuth redirect needs nothing built

**There is no redirect problem.** The user is already looking at the Agenta interface in a
browser when they click connect. Whatever address got them there is an address their browser
reaches. The authorization server does not fetch the redirect target; it only tells the browser
where to go next, and the browser has already proved it can get there.

That holds in every deployment:

| Deployment | The redirect address |
|---|---|
| Cloud | Our domain |
| Self-hosted, production | Their domain. A production web application has one, or nobody can log in |
| Development | The existing tunnel service, already wired into the development compose files |

**The tunnel stays development-only.** It is in the development compose files under a profile,
gated on an authorization token, exiting quietly when none is set, and the runner already
discovers its public address at runtime through the tunnel agent's own API. That is the right
scope for it. Outside development a deployment has a domain, and if an operator chooses to run a
tunnel anyway that is their arrangement, not something the product ships.

**The tunnels belong to the development-ingress work, and the gateways never add one.** That
work owns the tunnel services, their names, and the runner's selector; this design builds on top
of them and changes none of them. Three reasons a gateway-specific tunnel is not merely
unnecessary but harmful:

- **It would publish something already published.** The ingress tunnel forwards to Traefik, so
  every inbound route arrives on its normal path — the gateways are behind Traefik under `/api/`
  like everything else. A second tunnel to the same place adds no reach. That work states the
  rule directly: *"Do not add a tunnel per integration. One endpoint serves all of them"*, and it
  names the model and MCP gateways as one of the three consumers it was built for.
- **It would break tunnel selection, silently.** The runner used to take the first HTTPS tunnel
  it found, which was correct only while one existed. The ingress work replaces that with a match
  on the upstream a tunnel forwards to, precisely because a second tunnel makes order-based
  selection wrong. A third re-enters that space, and the failure is quiet: a sandbox handed the
  platform's HTTP API where it expected the object store.
- **Each tunnel is a live agent session.** Two already risk exceeding a provider plan — that work
  documents a single-agent fallback for exactly this. A third makes it likelier that the store
  tunnel fails, and Daytona sandboxes depend on that one for a durable working folder.

So the only inbound need this design has is the client-identity fetch below, it belongs to the
OAuth wave rather than to checkpoint A, and the ingress tunnel already serves it.

### The one thing that can genuinely fail

The newer client-registration mechanism makes the client identifier an HTTPS URL and has **the
authorization server fetch it** to read the application's name and permitted redirect addresses.
That fetch comes from the public internet, so it needs a publicly resolvable name — which a
deployment on an internal-only domain does not have, even though its own users reach it fine.

The answer is the older registration mechanism: the deployment posts its own metadata outbound to
the authorization server and receives an identifier. Nothing is ever fetched from us. It is
deprecated in general and it is the correct choice here, because it is the one path with no
inbound direction at all.

So the rule is: **prefer the document, fall back to registering outbound**, and a deployment on an
internal domain simply always takes the fallback.

### What was rejected, and why it was wrong

A hosted service on our domain to receive redirects for deployments that could not. It solved a
deployment shape that does not exist — a production web application with no address — and it
would have added a shared component holding other customers' authorization codes for no reason.
The mistake was reasoning about network topology in the abstract instead of asking how the user
got to the connect button in the first place.

## D25. A governance ceiling rejects; it never silently clamps

When a call exceeds a ceiling the platform set, the gateway denies it and says so. It does not
quietly lower the value and proceed.

**The distinction that makes this non-obvious.** A stated value can collide with a *physical*
limit or with an *operator's* limit, and those deserve opposite answers. Asking for more output
tokens than the context window holds is impossible, and the ecosystem is converging on treating
such a value as an upper bound and clamping it — that is the upstream's job, not ours. Our
ceilings are the other kind, and every comparable gateway rejects those: a managed API gateway's
token policy answers with distinct rate and quota statuses, and another's prompt guard and size
limiter both refuse rather than edit.

**Why silence is the wrong default here.** A ceiling exists to be accounted for. Lowering a value
quietly produces a run whose output differs from what was asked for with nothing explaining why,
and the compliance claim the ceiling exists to support stops being verifiable from the caller's
side.

**What makes rejection tolerable** is the content of the denial: it names the ceiling, the value
asked for, and the value allowed, so a caller retries correctly the first time. `open-designs.md`
records the evidence.

## D28. The outbound guard is the one the repo already has, called at both ends

A custom endpoint's URL is typed by a user, and the gateway is the process that connects to it.
That is a server-side request forgery sink: without a guard, a tenant can point an endpoint at
`http://169.254.169.254/` and have us fetch a cloud provider's instance secrets for them, with our own network
position and our own outbound allowances.

**Nothing new gets written.** `api/oss/src/core/webhooks/utils.py` already implements exactly this
guard, and three call sites already use it — webhook delivery, the EE organization OIDC issuer, and
the custom-provider URL on a secret. Its three functions are the whole vocabulary we need:

- `validate_url_format_and_literal_ip(url)` — scheme, host, no embedded credentials, and a literal-IP
  block, with **no DNS lookup**. This is the save-time gate; it exists because resolving at save time
  would reject a hostname that happens to be momentarily unresolvable.
- `resolve_validated_webhook_ip(url) -> str` — the same checks plus a DNS resolution, returning the
  single literal IP the caller must connect to.
- `validate_webhook_url(url)` — the same, discarding the IP.

Blocked means private, loopback, link-local (which is what covers the metadata address), reserved,
multicast or unspecified, and plain `http` is refused alongside them.

**Both ends, because one end is not enough.** Validating only at registration leaves the window
between saving a row and using it, during which the hostname's DNS answer can change. Validating
only at relay time means a plainly-bad URL is accepted, stored, and fails later at a confusing
moment. So: registration calls the no-DNS gate, and relay calls the resolving one.

**Relay connects to the returned IP, not the hostname.** This is the part that is easy to drop and
is the only reason the resolving variant returns a value at all. `core/webhooks/delivery.py`'s
`send_webhook_request` is the worked example: swap the host in the URL for the literal IP, set the
`Host` header back to the original authority, and pass `extensions={"sni_hostname": ...}` so TLS
still validates against the real name. Re-resolving the hostname at connect time reopens the rebind
window the check just closed.

**The runner's version is the closest sibling and contributes two refinements.**
`services/runner/src/engines/sandbox_agent/mcp.ts::validateUserMcpUrl` guards a user-supplied MCP
URL today, against a TypeScript range table deliberately mirrored from the Python one. It adds a
host allowlist read from `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`, so a self-hoster can permit one known
internal server without disabling the guard globally; and it separates "could not be resolved" from
"resolves somewhere blocked", so an operator reading a DNS typo does not see a security rejection.
Both are worth carrying. The runner cannot pin the resolved IP because it hands the URL to a harness
that reconnects; the gateway makes the call itself, so it can, and should.

**The flag that turns it all off is on by default.** `AGENTA_INSECURE_EGRESS_ALLOWED` defaults to
`true` in `api/oss/src/utils/env.py` — zero-config self-hosting is the reason — and it is set in no
deployment configuration in this repo, cloud included. So the guard as it stands is inert in
production. Two consequences, both on checkpoint A's list rather than deferred: the acceptance check
runs with the flag `false`, and turning it `false` on a shared deployment is a named deployment
action rather than an assumption.

**What is deliberately not decided here** is where the guard's code should live. Its home is a
webhook module and there are now four near-copies of it across the API, the SDK and the runner. The
gateway imports the API one exactly as EE's organization service already does — a cross-domain
import with precedent — and `cleanups.md` carries the consolidation.

## D29. No entitlement gate on the gateways; entitlements ship with metering

Every user has both gateways. There is no plan that grants one and withholds the other, so a
soft entitlement check in wave 1 would ask a question with only one answer.

**What entitlements will really express here is a limit** — calls, tokens, spend — not access.
And a limit cannot be enforced before anything is measured: the check needs a counter, the
counter needs a grain, and the grain is the thing `scope-checklist.md` already defers to the
billing wave because only knowing what will be billed answers it. So the entitlement check moves
to sit beside usage recording and charging, which already ship together for the same reason.

This closes R5, which asked which entitlement key to gate on. The honest answer is none: no flag
or counter in the entitlements catalogue fits, the nearest candidate is the legacy credits counter
D24 forbids reusing, and inventing a key to satisfy a call that always permits would leave a
placeholder for someone to mistake for enforcement.

**What stays.** `EntitlementDeniedError` remains declared in the seed and mapped to 403 at the
boundary, on the same reasoning as `MCPScopeInsufficientError` (§5): the type costs nothing, and
having it now means the wave that adds limits changes a body rather than a signature. The
permission check is untouched and remains wave 1 — permissions and entitlements answer different
questions, and conflating them is a known trap.

---

## D30. Three namespaces — `builtin`, `standard`, `custom` — split by whose secret pays. Supersedes D27's set

D27 named the three `agenta` / `builtin` / `custom` and treated `builtin` as an alias of the
secrets domain's *standard*. That alias was the error. The two are not the same idea, and the
difference is the one that decides who gets billed.

| Namespace | Whose secret | Who pays the upstream | LLM plane | MCP plane |
|---|---|---|---|---|
| `builtin` | **Agenta's.** We hold the account | Us, so we charge the caller | Reserved today; where a model we supply the key for lands | `agenta` tools and `composio` tools |
| `standard` | **The user's.** We only know the shape | The user, directly | The generated provider set — openai, anthropic, and the rest | Reserved, empty today |
| `custom` | The user's | The user, directly | A stored row: their own deployment or reseller | A stored row: a server they brought by URL |

**`standard` is not `builtin` under another name.** A standard target is one whose wire we already
know — the models, the base URL, the auth shape — so the user picks it from a list instead of
typing it. They still bring the key, and the provider bills them. A builtin target is one we own
the account for: nothing to bring, and the cost lands on us before we pass it on. Metering attaches
to `builtin` alone; `standard` and `custom` need no charging path at all. Calling both `builtin`
would have put a billing boundary inside a namespace.

**`agenta` is a provider inside `builtin`, not a namespace of its own.** It was never a fourth kind
of thing — it is us, as one supplier among the builtin suppliers, next to `composio`. So the
builtin path carries a provider segment and the rest is that provider's own grammar:
`/builtin/agenta/tools`, `/builtin/composio/{integration}/{connection}`.

**The internal vocabulary mismatch D27 absorbed disappears.** The secrets domain says *standard*
and now so does the URL. The two-line mapping D27 defended is deleted rather than defended.

**Each plane still reserves all three**, for D27's original reason: taking a keyword costs nothing
now, discovering later that something else took it costs a migration of live URLs. Today LLM's
`builtin` is empty and MCP's `standard` is empty.

**No migration.** `namespace` was never a column — every stored row is `custom` and the other two
are derived. The change is the enum, the route grammar and the catalogue's naming.

## D31. The inbound credentials travel in `X-AG-Credentials`, which outranks `Authorization`

D13 settled *what* authenticates a caller into the gateway — minted, ephemeral, never stored.
It put that token in `Authorization: Secret <jwt>`, one of the three schemes the middleware
already accepts. That placement is wrong for one route shape, and the fix is a header.

**Why `Authorization` cannot be the only door.** On a subscription pass-through route (D32)
`Authorization` carries the caller's own vendor authentication, forwarded unchanged to the
vendor. It is not ours to read and not ours to replace. A gateway that insists on
`Authorization` for its own identity has no way to accept both, which is exactly the
configuration pass-through requires.

**The rule is precedence, not fallback.** `X-AG-Credentials` wins whenever it is present;
`Authorization` remains for every existing caller and every harness that has only one slot.
Reading it the other way round — `Authorization` first, `X-AG-Credentials` as a fallback —
fails precisely in the case the header was introduced for, because both are present and the
wrong one is ours. One helper, consulted at both of the middleware's existing read sites.

**Both are stripped before any relay.** They authenticate the caller into the gateway; neither
belongs to an upstream. This is one shared frozen set in the gateways' domain root, applied on
both planes, and it closes a real leak: the MCP adapter forwarded caller headers wholesale and
dropped `Authorization` only when it had a secret of its own to substitute — so a NONE-scheme
tool server received the caller's platform token.

**What this does not change.** The token itself, its signer, its expiry, its claims, or the
three accepted schemes. D13 stands entirely; the value is the same string, and only where it
is read changes. Nothing needs a new secret kind, and the value stays out of any session
fingerprint (D13's known failure mode) for the same reason.

## D32. Subscription pass-through is a fourth funding shape, orthogonal to the namespace

D30 splits namespaces by whose *secret* pays: `builtin` is ours and bills through us,
`standard` and `custom` are the user's. Pass-through is none of those. The vendor authenticates
and bills the user's own **subscription**; the authentication stays in the harness; the gateway
holds no secret at all and contributes identity, policy, audit and attribution.

**It is a separate axis, not a fourth namespace.** A namespace answers "which backend, and
whose key". Pass-through answers "who authenticates" — and the same target could in principle
be reached either way. Modelling it as a namespace would force a false choice between the two
questions and take a fourth URL keyword for an answer that is not about routing.

**What it demands that nothing else does.** The gateway must *not* inject an upstream secret,
must not overwrite `Authorization`, and must forward the caller's vendor authentication
untouched — the exact inverse of every path built so far, all of which derive `Authorization`
from a resolved secret and overwrite whatever was there. That inversion is why it needs a
decision before it is built rather than after.

**Explicitly not built here, and not because it is unimportant.** It depends on facts about
harness releases that no design can assert — whether a given harness will send a second header
while keeping its vendor login, and whether that login survives a base-URL override. Building
against a guess is what makes this expensive. The prerequisite is a matrix test per harness,
tracked in `open-designs.md`.

**What is refused outright, and stays refused.** Centralising or replaying vendor subscription
session files as a substitute for per-user vendor auth. They are the user's own secrets, often
device-bound and renewable, and holding them would make us the custodian of exactly the thing
this design exists to avoid holding. If the gateway user and the subscription principal must be
proven to be the same person, that needs a provider-supported identity claim or an explicit
account-pairing flow — never token parsing.

## D33. The protocol front door is a route dimension; one today, more later

The gateway relays a protocol; it does not translate between protocols. Each native protocol is
its own front door under the plane, and a request never crosses from one to another:

```text
/v1/chat/completions   ->  OpenAI Chat Completions      (built)
/v1/responses          ->  OpenAI Responses             (later)
/v1/messages           ->  Anthropic Messages           (later)
```

**Why front doors rather than one normalised entry.** Translating one provider's tool-use,
reasoning, cache and structured-output semantics into another's is a permanent maintenance
liability that grows with every provider release, and it breaks upstream prompt caching, which
is the thing the byte-for-byte relay exists to protect. Adding a front door is additive: a
parser for that protocol's model field, a route, and the same policy pipeline behind it.

**`TranslatedLLMAdapter` is not the thing this refuses.** It translates *provider shape* behind
a single front door — a Chat Completions request reaching Bedrock, whose wire is not OpenAI's
and whose auth is request signing. It never turns a Messages request into a Responses one. The
two are easy to conflate and the distinction is what keeps D33 and D9 from contradicting each
other.

**What each new front door needs.** Its own minimal body parse for the policy fields (the model
id, the stream flag), its own usage extraction, and its own ceiling binding — Chat Completions
names the ceiling `max_tokens`, Responses names it `max_output_tokens`. Nothing else in the
pipeline changes: resolution, filters, ceilings, secrets and audit are all protocol-blind.

---

## Still open

Tracked in [`open-designs.md`](open-designs.md) until they settle here. Two earlier blockers
are now closed — the model call sites are counted and the routing library runs in-process
(`raw/model-call-sites.md`).

Four items previously listed here have since settled and are now decisions above: the MCP
endpoint shape (D16), step-up scope handling (D17), and embeddings, which are deferred with the
whole evaluator path (D15) rather than answered.

What remains:

- Which wave each capability lands in, marked in `scope-checklist.md`. This subsumes the older
  question about the order the six concerns arrive in.
