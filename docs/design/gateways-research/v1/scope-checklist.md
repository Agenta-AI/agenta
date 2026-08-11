# Scope checklist

Everything each gateway could do, listed so each item can be marked in or out, and ordered.
**Both gateways are being built.** This decides what is in the first increment of each, not
which gateway happens.

The `?` column is for marking: `1` = first increment, `2` = second, `-` = out for now.
Nothing here is decided.

---

## Shared: the policy core

Both gateways use these. An item marked out for one is out for both.

| ? | Item | What it is |
|---|---|---|
| | Token minting | Batch-mint one short-lived token per target at run start |
| | Token verification | Decode and check expiry; no database read |
| | Principal | The organization, workspace, project and user the token carries |
| | Permission check | Whether this principal may use this target at all |
| | Entitlement check | Whether the plan allows it |
| | Audit record | One row per call: principal, target, decision, outcome |
| | Meter sink | Usage recorded against the principal |
| | `secret_origin` stamp | Whether the call ran on the customer's secret or ours |

**What already exists.** The token is not new. `sign_secret_token` produces an HS256 JWT
carrying `user_id`, `user_email`, `project_id`, `workspace_id`, `organization_id`,
`organization_name` and an expiry, currently **15 minutes**. It travels as `Secret <token>`,
one of three accepted authorization schemes beside `Bearer` and `ApiKey`, and the middleware
verifies it by decode alone — no database read, with expiry and decode failures both rejected.

It is **already minted per run**: the workflow invoke prelude signs one for batch and detached
invokes, deliberately centralised so the two paths cannot drift on auth.

**The only extension needed** is a target. The payload carries who you are and nothing about
what you may reach, so today a token minted for one gateway target could be presented to
another. Whether the permitted set (which model, which tools, which caps) also goes in the
token is the open part — putting it there keeps verification to a signature check, at the cost
of a permission change not taking effect until the next mint.

---

## LLM gateway

| ? | Item | What it is | Note |
|---|---|---|---|
| | Ingress surface | An OpenAI-compatible endpoint | Every harness and the routing library already speak it |
| | Token verification | Shared, above | |
| | Model allowlist | Reject a model the token does not permit | This is the control that actually bounds exposure |
| | Parameter ceilings | Clamp `max_tokens` rather than reject | A harness that omits it still gets a bound |
| | Secret resolution | Which provider secret, whose, and its origin | |
| | Credential swap | Replace the caller's token with the real provider secret | The containment property |
| | Provider routing | provider × deployment adapters | The routing library does this; do not write it |
| | Streaming relay | Return upstream bytes untouched | |
| | Usage extraction | Read token counts off the stream tail | Record real usage from day one even if pricing is simpler |
| | Audit record | Shared, above | |
| | Balance check | Refuse when credits are exhausted | Needs the parallel credits work |
| | Retries and timeouts | Who pays for a failed call | |
| | Prompt caching pass-through | Do not break the cache marker | Worth several times the cost |
| | Fallbacks and aliasing | Try a second model on failure | Makes the gateway a product surface, not only an enforcement point |
| | Embeddings route | A second modality | Deferred with the evaluator path |

**Callers to convert:** agent v0, the runner, and the harnesses. Other services are out.

---

## MCP gateway

| ? | Item | What it is | Note |
|---|---|---|---|
| | Ingress surface | One URL per server, namespaced identifier | Pass-through, not a wrapper |
| | Token verification | Shared, above | |
| | Server registry | Register, list, remove a server; its route and auth mode | |
| | Tool allowlist | Restrict which of a server's tools are offerable | The wire already carries a per-server allowlist |
| | Secret resolution | Static token or OAuth grant, by owner | |
| | OAuth client | Discovery, registration, PKCE, refresh | The official SDK does all of it |
| | Consent flow | Connect a server from the dashboard | Extends the existing connect flow |
| | Step-up scopes | Ask for more permission mid-run | An interaction, reusing the missing-connection path |
| | Credential injection | Put the upstream secret in the outbound header | |
| | Proxy | Relay list and call unchanged | Tool names untouched |
| | List caching | Cache a server's tool list | Per server, since each URL is one server |
| | Audit record | Shared, above | |
| | Call metering | Count calls per principal | |
| | Dead-secret behaviour | Tools stay listed; the call fails | Settled |
| | Reachability for callbacks | Making the OAuth redirect reachable | See below |
| | stdio servers | Servers that run as a subprocess | Unsettled whether we support them at all |

---

## Reachability: three relay patterns already exist

The concern that a self-hosted deployment cannot receive an OAuth callback is not new, and the
codebase already solves the same shape three different ways.

**A provider-side relay with a routing key.** Stripe config carries a `webhook_target` that
falls back to `STRIPE_TARGET` and then to the machine's MAC address. Many developers share one
registered webhook and each receives only their own events, routed by that key.

**A socket tunnel in development.** The Composio config notes that the provider requires public
HTTPS, but that in development the tunnel delivers over a WebSocket instead — so the registered
URL only has to be a valid public HTTPS placeholder to mint the subscription secret. The real
delivery path is a socket the platform opens outward.

**An optional ngrok container, development only.** Both compose files define an `ngrok` service
that tunnels the object store, gated on `NGROK_AUTHTOKEN`: with no token it logs that remote
sandbox mounts are disabled and does nothing. The runner discovers the public URL from the
ngrok agent API. It is absent from the GitHub and production compose files entirely.

**What this means for OAuth callbacks.** The question is not whether a relay is possible — we
already run them, and already keep them out of production compose so they cannot be used by
accident. It is which of the three shapes fits: a socket the deployment opens outward (the
Composio pattern) needs no inbound reachability at all and is the closest fit.

---

## Deferred, with the reason

| Item | Why |
|---|---|
| Embeddings route | The evaluator path is another service, and the current scope is agent v0, the runner and the harnesses |
| Static MCP secret kind | Current targets are our own gateway and OAuth-protected servers |
| User-owned secrets | Not implemented today; the lookup already takes an owner so nothing is foreclosed |
| Account-wide secrets | Nothing needs them |
