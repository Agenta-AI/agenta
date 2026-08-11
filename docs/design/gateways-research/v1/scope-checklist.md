# Scope checklist

Everything each gateway could do, listed so each item can be marked in or out, and ordered.
**Both gateways are being built.** This decides what is in the first increment of each, not
which gateway happens.

The `?` column is for marking: `1` = first increment, `2` = second, `-` = out for now.
Nothing here is decided.

---

## The floor — no choice here

Without these there is no gateway, only an open proxy. They are not markable.

| Item | Why it is not a choice |
|---|---|
| Ingress surface | Something has to receive the call |
| Token verification | Without it anyone reaches any target |
| Target claim on the token | Without it a token minted for one target works on every other |
| Secret resolution | The gateway has to find the upstream secret |
| Secret injection | This is the containment property, and the point of the gateway |
| Forward and return | Including streaming, since every harness streams |
| Server registry (MCP) | Routing needs to know where a server is |

**What already exists.** `sign_secret_token` produces an HS256 JWT carrying `user_id`,
`user_email`, `project_id`, `workspace_id`, `organization_id`, `organization_name` and an
expiry, currently **15 minutes**. It travels as `Secret <token>`, one of three accepted schemes
beside `Bearer` and `ApiKey`, and the middleware verifies it by decode alone — no database read.
The workflow invoke prelude already mints one per run, centralised so batch and detached cannot
drift on auth.

**Settled:** the token also carries the **permitted set** — which model, which tools, which
caps — so authorisation stays a signature check with no database read. The cost is that a
permission change does not take effect until the next mint, bounded by the token's expiry.

Minting in a batch is an optimisation, not a scope item. Mint one at a time until it hurts.

---

## Shared choices

| ? | Item | Suggestion |
|---|---|---|
| | Permission check on the target | **In** — otherwise any authenticated user reaches any registered target |
| | Entitlement check | **Out** — coarser plan gating already exists elsewhere |
| | Audit record | **In** — cannot be backfilled |
| | Usage recorded | **In** — cannot be backfilled |
| | Usage charged | **Out** — the ledger is a separate effort |
| | `secret_origin` stamp | **In** — one field, unreconstructable later |

---

## LLM gateway choices

| ? | Item | Suggestion |
|---|---|---|
| | Model allowlist | **In** — the control that actually bounds exposure, and it is a string compare |
| | Parameter ceilings | **In** — one clamp, bounds a runaway call |
| | Timeouts | **In** — a gateway without one is an outage |
| | Retry policy | **Out** — the caller already retries |
| | Body byte-for-byte | **In** — a constraint, not a feature; prompt caching then works for free |
| | Fallbacks and aliasing | **Out** — makes the gateway a product surface with behaviour the caller cannot predict |
| | Embeddings route | **Out** — deferred with the evaluator path |

---

## MCP gateway choices

| ? | Item | Suggestion |
|---|---|---|
| | Tool allowlist | **In** — the wire already carries it; enforcing it here is what makes it a boundary |
| | OAuth client | **In**, and the single biggest item — the natural split point if one is needed |
| | Consent flow | **In** if OAuth is in; it is required by it |
| | Step-up scopes | **Out** for now — detect and fail visibly; add the interaction later |
| | List caching | **Out** — an optimisation, and correctness first |
| | stdio servers | **Out** — remote only; spawning processes is a large operational surface |

---

## Reachability: what exists, and why none of it carries an OAuth redirect

Three patterns exist in the tree for "the provider needs to reach us and cannot". None of them
solves the OAuth callback, and the reason is worth stating so nobody proposes them again.

**A provider-side relay keyed by a routing value.** Stripe config carries a `webhook_target`
falling back to `STRIPE_TARGET` and then to the machine's MAC address, so many developers share
one registered webhook and each receives only their own events.

**A socket subscription, development only.** `dispatcher_composio.py` describes itself as the
`stripe listen` equivalent: because Composio has no CLI tunnel, it subscribes to trigger events
over **Composio's own WebSocket** — `composio.triggers.subscribe()` — and forwards each one to
the local ingress, HMAC-signed with the same secret the API verifies, so the real signature path
is exercised rather than bypassed. It runs as a compose service under the `with-tunnel` profile,
on by default and disabled with `--no-tunnel`, and idles when no API key is set. The registered
webhook URL is a deliberate dummy on an RFC 2606 reserved host — it passes the provider's
anti-forgery check and is never delivered to, existing only to mint the subscription secret.

**An optional ngrok container, development only.** Both compose files define it, gated on
`NGROK_AUTHTOKEN`; without a token it logs that remote sandbox mounts are disabled and does
nothing. It is absent from the GitHub and production compose files.

### Why none of these carries an OAuth redirect

The socket pattern is **not a relay we built**. It works because the provider's own SDK offers a
subscribe call. An arbitrary authorization server offers nothing equivalent.

More fundamentally, **an OAuth redirect is a browser navigation, not an event delivery.** The
user's browser has to land on a URL. A browser redirect cannot travel down a socket the
deployment opened outward. Something the browser can reach has to exist.

The Stripe pattern is server-to-server routing, and has the same problem.

So the honest position: **ngrok is the only one of the three that produces a URL a browser can
reach, and it is development-only by design.** For a firewalled production deployment the real
options are a hosted relay that receives the redirect and holds the code while the deployment
polls outward for it — which works, but reintroduces a cloud dependency — or documenting that
OAuth-protected servers need a reachable deployment while static-credential servers work
everywhere.

## Deferred, with the reason

| Item | Why |
|---|---|
| Embeddings route | The evaluator path is another service, and the current scope is agent v0, the runner and the harnesses |
| Static MCP secret kind | Current targets are our own gateway and OAuth-protected servers |
| User-owned secrets | Not implemented today; the lookup already takes an owner so nothing is foreclosed |
| Account-wide secrets | Nothing needs them |
