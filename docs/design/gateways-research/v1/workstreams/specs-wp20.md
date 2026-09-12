# WP20 — Client registration fallback

**Owns:** `core/gateways/mcps/oauth/registration.py`, the client-identity-document route
(`apis/fastapi/gateways/mcps/oauth_router.py`), and the strategy branch inside
`MCPOAuthConnectService._resolve_client_info` (specs-wp17.md). Nothing outside that.

**Depends on:** WP17. There is no callback-reachability work in this package — D26
already settled that the browser reaches the redirect in every deployment, because it is
the address the user is already on. What is left is registration: WP17 always registers
outbound (RFC 7591); this package adds the client-identity-document mechanism in front of
it and decides automatically which one runs, per connect attempt, with no configuration
flag.

**Done when:** a deployment on an internal-only domain completes a full authorization
with no hosted component of ours in the path. It already does — WP17's outbound path was
always internal-only-safe; this package's job is to prefer the newer mechanism on a
deployment that can actually use it, without breaking the one that can't.

---

## The two mechanisms, and why they cannot be tried the same way

**Outbound (WP17, unchanged).** We `POST` our own metadata to the authorization server's
`registration_endpoint` and get a `client_id`/`client_secret` back, synchronously, in a
response we read. If it fails, we see the failure — a non-2xx response or a connection
error — and `MCPOAuthRegistrationError` already carries that (specs-wp17.md).

**The client identity document.** Our `client_id` is an HTTPS URL on our own domain
(`{AGENTA_API_URL}/gateways/mcps/oauth/client-metadata.json`); the authorization server
fetches it — not from us, and not synchronously to any request we make. It fetches it
while rendering the consent screen, after we have already redirected the user's browser
away from us. There is no response body of that fetch for us to read: if it fails, the
authorization server aborts the flow **on its own error page**, and the browser never
reaches our callback at all — not even with an error. We are not part of that failure. We
cannot be, structurally: the redirect_uri the authorization server would use to tell us
anything is itself a field *inside* the document it just failed to fetch.

**This is why "attempt and fall back" does not work as a runtime decision.** There is no
attempt whose outcome we can observe. By the time a failure would exist, we have already
handed the user to another party's page and have nothing left to retry. A per-request
try/except around the document mechanism has no exception to catch.

**This is also why introspection is unreliable, not merely inconvenient.** The one thing
that decides which mechanism is safe is whether *the authorization server*, reaching out
from the public internet, can fetch our identity document. Any check we run happens on
our own network, resolving our own name through our own path — which is exactly the
question split-horizon DNS answers differently depending on who's asking. A server can
always reach itself. That tells us nothing about whether anyone else can.

## The detector

Given both of the above are ruled out as *reliable* signals, the design accepts a
signal that is directionally reliable rather than a signal that is always right, and
biases it toward the failure mode that is recoverable.

**The rule:** resolve `AGENTA_API_URL`'s hostname via DNS. Attempt the document only when
the scheme is `https` and **every** resolved address classifies as public — not private,
loopback, link-local, reserved, multicast, or unspecified (the same six-way
classification `core/webhooks/utils.py`'s SSRF guard already uses for the opposite
question, D28; not imported from there, because that guard's job is rejecting a URL a
tenant handed us, and this one's is classifying our own configured domain — different
domains, same primitive, reimplemented locally rather than reached into as a private
helper). Any ambiguity — resolution fails, times out, answers empty, or answers with even
one address that isn't public — answers "not resolvable."

```python
# core/gateways/mcps/oauth/registration.py
def is_publicly_resolvable(api_url: str, *, resolve: Resolver = _default_resolve) -> bool:
    ...
    return all(_is_public_ip(ip) for ip in parsed_ips)
```

`all()`, not `any()`. A deployment that is multi-homed onto both a public and an internal
address is exactly the shape that would otherwise slip through on `any()`, and it is
indistinguishable at this layer from a deployment whose public-looking address is a NAT
gateway with nothing listening on the other side.

**Where the fact comes from is a real limitation, stated rather than hidden.** DNS
resolvability is not reachability. A public IP can still be firewalled, and split-horizon
DNS can still make our own resolution disagree with what the authorization server sees.
This detector does not solve that; it narrows it, and the next section says exactly what
happens when it's wrong.

**Re-probed per connect attempt, not cached, not configured.** The check is a local DNS
lookup — cheap, and already bounded by the existing "reuse a stored registration if one
exists" branch below, so a working deployment only ever pays for it once per
authorization server before that branch short-circuits it.

## The strategy, in order

`MCPOAuthConnectService._resolve_client_info()` (specs-wp17.md's seam — WP17 named this
call exactly: *"today it always does RFC 7591 dynamic client registration outbound...
WP20's job... is entirely about the other mechanism"*):

1. **Reuse a stored outbound registration if this authorization server already has
   one.** Unchanged from WP17. A working registration is never displaced by a later,
   possibly different, detection result — stability over re-optimizing a connection that
   already works. (The document mechanism is never stored — see below — so this branch
   can only ever be true for a prior *outbound* registration.)
2. **Else, if `is_publicly_resolvable(AGENTA_API_URL)`: use the client identity
   document.** No registration call is made — the document mechanism has no
   registration step at all. `client_id` is `client_metadata_url()`; there is no
   `client_secret` (a public client, secured by PKCE + `redirect_uri` matching, per the
   mechanism's own design — the identity document declares who we are, it does not prove
   a secret).
3. **Else, register outbound (WP17, unchanged)** and store the result exactly as before.

Steps 2 and 3 are mutually exclusive per attempt; nothing here ever tries one after the
other inside a single `begin()` call, because — as established above — there is nothing
that would ever tell it to.

## The document is static and deployment-wide, not per-project or per-server

`client_metadata_document()` needs nothing from the connect attempt except the fixed
callback URL WP17 already built (`callback_redirect_uri`). It carries no project id, no
server URL, no scope list — just `redirect_uris`, `grant_types`, `response_types`,
`token_endpoint_auth_method: "none"`, `client_name: "Agenta"`. One document, one URL,
served by one new unauthenticated route, for every project on the deployment.

This is a deliberate departure from WP17's per-project outbound registrations (each
project registers its own `client_id`/`client_secret` with a given authorization server,
per specs-wp17.md's "Keys"). The document mechanism has no secret to keep separate
between projects — the "identity" it asserts is the Agenta application, once, for the
whole deployment, exactly as the tenant partition already treats `oauth_grant` (the
tokens) as the project-scoped thing and `oauth_provider` (the client identity) as
comparatively incidental. Nothing about per-project tenancy is at stake in *which*
mechanism registered the client; only the tokens a project's user later grants are
project-scoped, and those are unaffected by this package (`SecretsTokenStorage.write_
tokens`, unchanged).

**Consequence: nothing is written to the vault for the document path.** `oauth_provider`
storage exists to remember a `client_secret` and avoid re-registering; the document
mechanism has neither. `begin()` re-derives the same client identity deterministically
every time it takes this branch, and `complete()` does the same — see below.

## The route

`GET /gateways/mcps/oauth/client-metadata.json`, unauthenticated (added to
`middlewares/auth.py`'s `_PUBLIC_ENDPOINTS`, the same list `/tools/connections/callback`
already sits in for the identical reason — a third party arrives with no token of ours).
No path parameter: this is the one static document above, computed from `env.agenta.
api_url` on every request, never persisted, never varying per caller.

## Why `state` carries the choice, and `complete()` never re-decides

`complete()` runs after the browser has come back — it re-discovers the token endpoint
and needs a `client_info` to exchange the code with, same as WP17. It must resolve
**the same client identity `begin()` actually put in the authorization URL**, not
whatever `is_publicly_resolvable()` would answer *now*. Those can disagree: DNS can
change between the redirect and the callback, and re-probing at `complete()` time would
risk building a token-exchange request under a `client_id` the authorization server never
saw at authorization time.

So the state token (`core/gateways/mcps/oauth/state.py`) gains one field, `strategy:
"document" | "outbound"`, alongside the fields WP17 already carries. `complete()` reads
it and either re-derives the identity document deterministically (no storage lookup) or
falls back to WP17's existing storage-backed lookup, raising the same
`MCPOAuthClientNotRegisteredError` it always did if that lookup comes up empty — that
error's meaning is unchanged: *a stored outbound registration existed at `begin()` time
and is gone now.* It is not repurposed to mean anything about the document path, because
the document path never has anything stored to lose.

## Wrong in each direction

The two failure modes are not symmetric, and the detector is deliberately biased toward
the one that is recoverable.

**Direction 1 — detected "resolvable" when the authorization server actually cannot
reach us.** (A public-looking IP that is firewalled, NAT'd with nothing listening behind
it, or resolves differently for us than for the authorization server's own resolver.) We
redirect the user's browser to the authorization server with `client_id` pointing at our
document. The authorization server's fetch fails. It shows **its own** error page instead
of a consent screen. We receive no callback — not a success, not an OAuth error redirect,
nothing — because, as above, the authorization server never even learns our
`redirect_uri`. The signed `state` token simply expires unused an hour later. From the
user's side this looks like the connect button leading nowhere. There is no code path in
this package, or reachable from it, that detects or recovers from this: it is a genuine,
acknowledged blind spot, not an oversight. The only lever an operator has is fixing the
underlying DNS/network fact (the deployment's public-facing record must actually be
reachable, not merely resolve), because there is deliberately no configuration flag to
force the outbound path instead — retrying the connect attempt after that fix succeeds
immediately, since nothing about the failed attempt persisted anywhere to clean up.

**Direction 2 — detected "not resolvable" when the authorization server actually could
have reached us.** (Split-horizon DNS answering our own lookup with a private address for
a name that is genuinely public elsewhere, or a resolution that times out for a domain
that is otherwise fine.) We take the outbound path. It works — WP17's mechanism was never
conditioned on reachability in the first place, since nothing is ever fetched from us on
that path. The only cost is one RFC 7591 registration call that a working deployment
didn't strictly need, which is invisible to the user and has no functional consequence.
This is the harmless direction, and it is why `all()` rather than `any()`, "fails closed"
rather than "fails open", and every ambiguous case in `is_publicly_resolvable()` all point
the same way: toward this direction rather than direction 1.

**Why no config flag, stated against this specific risk.** A flag would let an operator
who hits direction 1 force the outbound path permanently — the brief this package answers
explicitly rules that out ("make that fallback automatic rather than a configuration
flag... a deployment must not have to be told which world it is in"), and the reasoning
holds even acknowledging direction 1's cost: a flag is a second thing that can be wrong
(set and stale after a network change, or simply never set because nobody deploying today
knows this package exists), where the detector is at least always reevaluated against the
deployment's current DNS answer. The residual risk in direction 1 is real and is paid in
full by the operator of a deployment whose public-looking address doesn't actually route
— but it is paid once, is diagnosable (the authorization server's own error page names the
failure, even if not to us), and self-heals the moment the underlying network fact is
fixed, without a stale flag to also remember to flip back.

## Keeping discovery and registration failures distinct

`MCPOAuthDiscoveryError` (specs-wp17.md) means "no protected-resource or
authorization-server metadata could be found" — it is raised by `client.discover()`,
which every path through `begin()`/`complete()` still calls **first**, unchanged from
WP17. This package's strategy choice runs only after that call returns successfully; nothing
here wraps, catches, or re-raises a discovery failure as anything about registration.
`MCPOAuthRegistrationError` keeps its exact WP17 meaning too — "the authorization server's
own `registration_endpoint` rejected our outbound registration" — and is reachable only
from step 3 of the strategy above. The identity-document branch introduces no new
exception at all: `is_publicly_resolvable()` never raises (any internal failure answers
`False`, per "Wrong in each direction" above), and there is nothing about the document
mechanism itself that can fail synchronously in our process. A production incident
report of "we could not find the authorization server" and one of "we found it but
couldn't register" (or "registration looked fine but the user never came back") remain
three distinguishable statements, not one collapsed diagnosis.

## Contracts

- **No config flag decides the strategy.** `is_publicly_resolvable()` takes an injectable
  `resolve` for tests; production wiring supplies no override and gets real DNS by
  default — the same shape as `MCPOAuthClient(transport=...)`'s existing seam.
- **The document mechanism writes nothing to the vault.** Only `oauth_grant` (the tokens,
  written by `complete()` regardless of strategy) and, on the outbound branch only,
  `oauth_provider` (unchanged from WP17).
- **`complete()` never re-probes.** The strategy travels in `state`, signed the same way
  WP17's `code_verifier` already does, for the same reason: no server-side session to
  hold it in, and a decision that must match what `begin()` actually put in the
  authorization URL rather than a fresh answer to a question that could have changed.
- **The route is one static document, unauthenticated, with no path parameter.**
  `apis/fastapi/gateways/mcps/oauth_router.py` reads nothing from the request.

## Tests

Unit only, no live network, no real authorization server — `httpx.MockTransport` for the
authorization server, an injected `resolve` for DNS, a `TestClient` against a bare
`FastAPI()` app for the route, matching WP17's own precedent.

- `registration.py`: a public address resolves as resolvable; a private one does not; a
  mix of public and private does not (conservative `all()`); resolution failure, empty
  answer, and non-`https` scheme all answer not-resolvable; the served document carries
  no `client_secret`; `identity_document_client_info()` is deterministic across two calls.
- Strategy: `begin()` prefers the document when resolvable, with no registration call and
  no `oauth_provider` row written; `begin()` falls back to outbound when not resolvable,
  identical to WP17's existing behavior; a second `begin()` for the same server keeps
  using the document without re-registering (nothing to re-register).
- `complete()` via the document path succeeds with nothing stored beforehand.
- **Wrong in each direction:** a test pinning that a resolved address classifying public
  is treated as resolvable regardless of actual reachability (the detector's documented
  blind spot, direction 1) — proceeding is the correct, current behavior, not a bug to
  fix later. A test proving a misdetected-as-internal domain (direction 2) still
  completes a full authorization end to end via the outbound path.
- The route: serves the document with no `Authorization` header required by the test
  client itself (no middleware in the test app at all — the auth-exemption is a one-line
  addition to `_PUBLIC_ENDPOINTS`, verified by inspection rather than a live-middleware
  test, matching how the sibling exemptions in that list are treated).

## Out of scope

- Callback reachability — D26, already closed, not reopened here.
- Whether real-world authorization servers still accept RFC 7591 outbound registration,
  or reject a redirect target on a non-public domain — OD6's own "establish at
  implementation time, neither blocking" note, unchanged by this package.
- A stored-nonce replay ledger for `state` — WP17's own flagged gap, untouched.
- Any UI for the consent screen or the connect button — WP18.
