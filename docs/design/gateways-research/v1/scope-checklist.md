# Scope checklist

Everything each gateway could do, with the wave it lands in. **Both gateways are being built.**
This decides *when* each capability arrives, not which gateway happens.

**The mark is a wave, never "in or out".** In-and-out was the wrong axis: almost nothing is
genuinely out, so "out" ended up meaning three different things — not now, not ever, and not
decided — and the column stopped carrying information.

| Mark | Meaning |
|---|---|
| `1` | Wave 1 — both gateways working end to end, on the fakes and our own servers |
| `2` | Wave 2 — every caller converted |
| `3` | Wave 3 — OAuth end to end |
| `later` | Real gateway work, after checkpoint C |
| `—` | Out of this work; a separate effort owns it |

**A checkpoint is a deploy, not a release.** Nothing between here and checkpoint C carries user
traffic, so nothing observable happens that could have been recorded and was not. That kills the
usual argument for building recording early — "it cannot be backfilled" is only true once there
is something real to miss.

Anything that is not gateway work at all is **not listed**. A row that will never be marked is
noise on a decision surface.

---

## The floor — no choice here

Without these there is no gateway, only an open proxy. They are not markable.

| Item | Why it is not a choice |
|---|---|
| Ingress surface | Something has to receive the call |
| Token verification | Without it anyone reaches any target |
| Secret resolution | The gateway has to find the upstream secret |
| Secret injection | This is the containment property, and the point of the gateway |
| Forward and return | Including streaming, since every harness streams |
| Endpoint CRUD (both) | Custom endpoints need creating and configuring; standard ones are generated |
| Test doubles | A fake LLM endpoint and a fake MCP server; nothing third-party in tests |

**What already exists.** `sign_secret_token` produces an HS256 JWT carrying `user_id`,
`user_email`, `project_id`, `workspace_id`, `organization_id`, `organization_name` and an
expiry, currently **15 minutes**. It travels as `Secret <token>`, one of three accepted schemes
beside `Bearer` and `ApiKey`, and the middleware verifies it by decode alone — no database read.
The workflow invoke prelude already mints one per run, centralised so batch and detached cannot
drift on auth.

**Settled:** one gateway-wide token, unchanged. No target claim and no permitted set — the
gateway authorises per call through the normal permission path. Per-endpoint tokens and a
permitted set arrive later with user-owned secrets, when the grain goes project, then user, then
endpoint. Batch minting is an optimisation, not a scope item.

**An endpoint is a server** (D19): an LLM endpoint is a provider serving many models, an MCP
endpoint is a server serving many tools. **Standard endpoints are generated, not stored** (D20)
— the provider-to-models catalogue is already a static map in the SDK, so a standard route is
derivable from the provider name and no slug is needed. Only custom endpoints become rows.

---

## Shared

| Wave | Item | Why there |
|---|---|---|
| 1 | Permission check on the target | Otherwise any authenticated user reaches any registered target. Without it wave 1 is an open proxy |
| later | Entitlement check | **Moved out of wave 1.** Every user has both gateways — there is nothing to gate on. What entitlements will actually express here are *limits*, and a limit is meaningless before anything is measured, so this ships with usage metering and billing rather than ahead of them (D29) |
| 1 | Body byte-for-byte, **both gateways** | Not an LLM property. Transparency *is* the MCP gateway — same tool names, same schemas, same errors — and on the model side it is what keeps prompt caching working. One constraint, stated once |
| 1 | Outbound target guard on user-supplied URLs | The gateway becomes the process that connects to an address a tenant typed. Without it, a custom endpoint pointed at the cloud metadata address makes us fetch credentials on a tenant's behalf. Nothing is written — the repo's existing guard is called at registration and at relay (D28) |
| 2 | Audit record | One event per call into the existing events domain |
| later | Usage recorded | Ships with charging, below |
| later | `secret_origin` stamp | One field marking whose key paid. It rides the usage record, so it moves with it |
| later | Endpoint configuration | Timeouts, ceilings and extra headers per custom endpoint. Making calls work comes first; tuning them is second-order and blocks nothing |
| later | Usage charged | The credits ledger. Recording and charging ship together |

**Why recording waits for charging.** Recording early is normally right because usage cannot be
backfilled. That argument does not apply here: no checkpoint before C is a release, so no real
traffic passes and there is nothing to miss. What remains is the cost of guessing — **which
counters, at which grain, keyed how** — and the only thing that answers it is knowing what will
be billed. Building the meter before the price produces data nobody can use and a schema to
migrate.

---

## LLM gateway

| Wave | Item | Why there |
|---|---|---|
| 1 | Model allowlist | Custom providers already declare their models by slug; standard providers expose their whole catalogue |

---

## MCP gateway

| Wave | Item | Why there |
|---|---|---|
| 1 | Tool allowlist | The runner wire already carries it; enforcing it at the boundary is what makes the boundary real |
| 3 | OAuth client | The single biggest item, and the reason wave 3 exists |
| 3 | Consent flow | Required by OAuth; ships with it |
| 3 | Step-up scopes | Asking for more permission mid-run. Same wave as the client that raises it |
| — | List caching | An optimisation. Correctness first, and nothing is slow yet |
| — | stdio servers | Remote only. Spawning processes is a large operational surface for no current caller |

---

## Not gateway work at all

Removed from the list above rather than marked out, because a row that will never be marked
clutters a decision surface.

| Item | Where it belongs |
|---|---|
| Retry policy | Never discussed and not planned. Callers already retry |
| Fallbacks and model aliasing | Never discussed and not planned. It would make the gateway decide what the caller asked for |
| Embeddings route | Belongs to converting the remaining services and callers, alongside the evaluator path — the same bucket as every other service, not a gateway capability |

---

## Reachability: what exists, and why the OAuth callback does not need any of it

**The callback needs nothing built (D26).** The user is already looking at the Agenta interface
in a browser when they click connect, so the address that got them there is one their browser
reaches. Cloud has a domain, self-hosted production has a domain, development has the tunnel
already in the compose files. The tunnel stays development-only.

The three patterns below exist for a different problem — a provider needing to reach us — and are
recorded so nobody proposes them for this one.

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
deployment opened outward.

The payment-provider pattern is server-to-server routing, and has the same problem.

### And why the callback does not need one anyway

The three patterns above answer "a provider must reach us and cannot." The OAuth callback is not
that question. Nobody needs to reach us who has not already: the browser being redirected is the
browser that just loaded our interface.

The only part of an OAuth flow that requires an inbound connection from a stranger is the
**authorization server fetching a client identity document**, and a deployment on an
internal-only domain answers that by registering outbound instead (D26).

## Deferred, with the reason

| Item | Why |
|---|---|
| Embeddings route | The evaluator path is another service, and the current scope is agent v0, the runner and the harnesses |
| Static MCP secret kind | Current targets are our own gateway and OAuth-protected servers |
| User-owned secrets | Not implemented today; the lookup already takes an owner so nothing is foreclosed |
| Account-wide secrets | Nothing needs them |
