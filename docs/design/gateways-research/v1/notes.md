# Notes

Replaced positions and observations. Read this when something in the other documents looks
wrong and you want to know whether it was already considered.

Everything else here states only what is. History lives in this file and rationale lives in
`decisions.md`.

---

## Replaced positions

### The principal was not a blocker

An early draft treated identity as the blocking decision, on the reading that connections are
project-scoped and therefore the platform could not attribute a call to a person.

That conflated two separate things. **Who is calling us** is answered on every request by an
auth context carrying organization, workspace, project and user, rejected outright if any is
missing. **Which stored credential we then use** is a different lookup. The first was never in
question.

The correction matters beyond the one point: it is why `secrets.md` treats attribution and
credential ownership as independent, and why user-level credentials need no caller-side
change.

### Dual-mode adoption was wrong

An early version offered "gateway and direct paths coexist, defaulting to direct." Rejected: a
governance boundary with an exception is not a boundary, and one bypass costs every claim
about policy, audit, spend and credential containment. See `decisions.md` D1.

The related understatement — that adoption is "a resolver-side change" — was only ever true of
the runner caller, whose wire already expresses a gateway route. Every other caller is a real
change.

### "In-process in the SDK" was the wrong frame

An early argument preferred converting the workflow path first because it runs in-process.
Wrong regardless of which path goes first: callers depend on ports, and the adapter behind the
port talks to the gateway. The SDK keeps its secret-fetch and secret-injection capabilities;
only the implementation behind them changes.

### A token store was invented that should not exist

The design briefly called for a token store with its own encryption. It should never have
been: the established pattern is that a domain row carries a secret id, the secrets service
holds the value, and the consumer resolves it at use time — exactly what webhook subscriptions
and SSO providers already do.

What survived is much smaller: two new secret kinds. See `secrets.md`.

### The internal tool channel is not a proto-gateway

The runner has an internal channel that delivers first-party tools to a harness over MCP. It
was briefly cited as evidence that an MCP gateway already half-exists.

It is a separate concern — internal tool delivery, not third-party server brokering — and
conflating the two would drag its permission-rule and transport constraints into a design that
does not need them. Excluded deliberately.

### Two "prerequisites" had the causality backwards

An earlier revision listed two things as blockers in front of the gateway. Both are the
reverse: they are outcomes the gateway makes possible.

**The secrets read surface.** It returns plaintext to any caller holding the view permission,
and the agent path resolves straight through it. This was written up as something to fix first.
It cannot be fixed first — callers read that route because it is how they obtain a provider key
at all. Only once everything goes through the gateway does nothing need it, and only then can it
be restricted.

The reasoning behind the error is worth recording: it assumed the gateway's value was mainly
security, so an unsafe vault appeared to undermine it. The gateway is also governance, identity,
metering and inversion of control, none of which depend on the vault's current read behaviour.

**Module-level provider keys in one handler.** Also written up as a blocker. That pattern exists
*because* there is no gateway and no dependency injection — a handler mutates library globals
because nothing hands it a resolved connection. It is one of the things the gateway fixes, so it
cannot gate the gateway. The handler in question is also unused and likely to be dropped, which
makes the finding moot as well as misplaced.

**The general lesson:** when something in the current design looks like it must be fixed first,
check whether the new design is what makes the fix possible. Sequencing a fix ahead of its
enabler produces a plan that cannot start.

### A static secret kind was proposed twice and withdrawn twice

First proposed as a new kind, then withdrawn in favour of reusing the general-purpose custom
secret kind, then withdrawn again because existing kinds must not be overloaded — each exists
for something specific.

The resolution is that no static kind is needed *in the current scope*, because the targets are
Agenta's own gateway and OAuth-protected servers. It returns when a third-party server
authenticating with a static token does.

### The inbound credential was confused with the upstream secret

An early draft treated the credential authenticating a caller *into* the gateway as a thing
needing a vault kind. It is not a secret at all — by the vocabulary the tree already uses, it is
a *credential*, Agenta's own auth. It is minted, ephemeral and never stored (D13).

The mechanism already existed on both ends and neither was found before proposing a new one: the
access router already re-mints short-lived signed scope-carrying tokens rather than echoing an
API key, and the runner already treats its tool-callback bearer as per-turn material excluded
from the session fingerprint.

### Step-up was designed as a failure before the existing path was checked

An early recommendation was to request every scope a server advertises at connect time, and to
fail a call with a clear error when a step-up happened anyway. Both were wrong.

Requesting everything removes the user's choice; the correct default is to let them select.
Failing is inconsistent with what already happens when a tool needs a connection that does not
exist — that raises an interaction with a connect affordance. Step-up is the same situation and
reuses the same path.

### Scope crept from the callers to the whole tree

The embeddings finding — two evaluator callers that cannot use a chat-only gateway — was
correct, and was then used to argue that the north port needed an embeddings route now. The
current scope is the gateways, agent v0, the runner and the harnesses (D15). Other services come
later, and so does that route.

---

## Observations

### The auth-scheme axis was already built

Proposed here as new, then found implemented across three domains, along with the
ready / needs-auth / needs-input state machine and a connect affordance returned from
discovery. Both auth schemes already share one hosted-redirect flow with no secret on the
request payload.

The lesson generalizes: this design's remaining novelty is much smaller than it first
appeared, and the reflex should be to look for the existing shape before proposing one.

### The OAuth callback machinery is already built, twice

Proposed here as work, then found in the tree.

**A signed state parameter.** The connections domain already mints a server-owned, HMAC-signed
OAuth state carrying the project and the user, with a one-hour default validity, and decodes it
on the way back. The callback route is the one endpoint in the whole gateway family with no
permission check, because it authenticates on that signed state rather than on a tenant
credential, and it answers with a small HTML page that closes the popup.

**A signed inbound webhook.** The triggers ingress verifies an HMAC over an identifier, a
timestamp and the body, with a freshness window and a replay check, then enqueues and returns
immediately. An inbound OAuth callback to a firewalled deployment is the same shape.

The MCP OAuth work therefore inherits the state signer, the unauthenticated-callback pattern and
the popup-closing response. What it does not inherit is reachability, which is why that stays
open — see `open-designs.md`.

### One flaw in that machinery, worth fixing rather than copying

The callback path the connections service builds is hardcoded to the tool domain's mount, even
though the trigger domain creates connections through the same service. A third consumer would
make that three. The comment in the code says the public contract was kept unchanged when the
connection moved into its own domain, which explains it without justifying inheriting it.

### The two-axis credential model came from a real gap

"API key versus OAuth" conflates authentication method with credential ownership. Personal
access tokens are static and per-user; some OAuth grants are organizational. The existing code
has the first axis and not the second — correctly, since ownership does not yet vary.

### Statelessness and OAuth get conflated easily

Going stateless removed protocol session state. OAuth is credential lifecycle state. The
current protocol revision removes the first and leaves the second fully specified. The gain
from statelessness is a cheaper gateway, not less authorization work.

### The spec now favours intermediaries

Three changes in the current revision are explicitly about things sitting in the middle:
header-based routing, cacheable list results with a shared-intermediary scope flag, and the
replacement of server-initiated callbacks with a retry pattern. The last is what turns a
gateway from a stateful broker into a plain proxy.

### Folder names mislead on the model side

The SDK folder named after the model client library holds an observability callback handler.
The actual routing lives in the secrets manager's provider-settings builder. Anyone sizing the
model work from folder names will size the wrong thing.

---

## Structural notes

### The sibling is mirrored, not joined — a position that was wrong twice

The channels design chose an existing multi-provider integration domain as its structural
sibling and copied its layout.

**First position, wrong.** The gateways have no such sibling, because they *extend* the family
that would have been it — catalog, connections, tools and triggers.

**Second position, also wrong.** The same reasoning survived into a draft of `entities.md`,
which put both planes inside that family on the grounds that the family is defined by outbound
brokerage behind ports and registries.

That is structural similarity, not domain kinship, and it proves nothing: **every** domain in
this repo has ports, a registry and adapters. Judged by what it holds rather than by what it is
called, the existing family is an *integrations* domain — its contracts are integrations and
integration keys, its one table is a connections table, its consumers are tools and triggers, and
its only provider is Composio. The word "gateway" in its name means an integration gateway to
that one provider.

Ours is traffic transiting a boundary: identity, policy, secret injection and metering, per call,
on the data path. It shares a word and nothing else.

**Settled position.** A separate domain that mirrors the family's shape without joining it —
`gateways/` beside the existing `gateway/`, with both planes and the shared policy core inside
it. Table names deliberately do not mirror the folder path, because a name sorting beside the
connections table would read as kin.

Two consequences. The shared auth-scheme and connection-state vocabulary is defined in our own
domain rather than unified into theirs, which would have re-coupled us through the back door;
the existing copies are out of scope (D15). And one genuine reference survives without being
evidence of kinship: a Composio-brokered MCP server points at a connection row, which is our
registry referencing theirs.

**The general lesson: shared vocabulary is not shared domain.** Two things called gateways were
nearly merged because of a word.

### Why there are two quarantine documents

The channels design pushed platform facts into one document so the neutral documents would
survive platform churn. The same reasoning applies here twice over, because the two planes
churn independently: the protocol revises on its own schedule and provider APIs on theirs. One
combined document would couple them.

### Why there is no capability-declaration document

The channels design needed one because its adapters had genuinely different feature sets and
core had to decide what was offerable. Here the adapter differences are narrow and already
expressible — auth mode on the tool side, provider and deployment on the model side — so a
declaration layer would be ceremony. `policy.md` occupies that slot, since what actually
varies is policy rather than capability.

Revisit if MCP server differences turn out to be wider than auth mode.

### Why there is no out-of-process adapter contract

The channels design needed a wire contract because third parties would implement bridges. No
equivalent need has been established here, and inventing one would create a compatibility
surface with no consumer.

---

## Watch list

- Whether `policy.md` splits into two documents with little in common. If it does,
  `decisions.md` D7 is wrong and the gateways should be separate systems.
- Whether the routing library is usable in-process. This decides whether the model plane is a
  library integration or a service, and several packages depend on the answer.
- Whether refresh-token support is complete in the MCP SDK version we would pin. It was still
  landing across SDKs during 2026.
- Whether any upstream we care about lacks Client ID Metadata Document support and forces the
  deprecated registration fallback.
- Whether the deprecation of server-side sampling changes what upstream servers do, since a
  server needing a model would then call the LLM gateway — the point where the planes touch.
