# Context

## Why this work exists

Event triggers today are Composio-only: `TriggersGatewayRegistry` has exactly one adapter, and a subscription requires a Composio `connection_id`. For cloud users that's fine. For self-hosting users it means a hard dependency on a third-party SaaS that also sees their event payloads — which undermines the point of self-hosting. Known concrete gap: Telegram triggers are impossible today (no Composio trigger coverage), and PostHog trigger coverage is thin even though PostHog can natively POST to a webhook destination.

The broader strategy (settled July 2026): **MCP = actions plane, own trigger providers = events plane**. MCP has no trigger primitive (client-driven protocol; the MCP Triggers & Events WG is incubating a webhook-like callback extension — `modelcontextprotocol/experimental-ext-triggers-events`). So "MCP + AI triggers" concretely means: MCP servers for tools (separate track), and this plan for events.

## Goals

- A self-hosted deployment can create event triggers for the major providers (GitHub, Telegram, Stripe, Slack events, PostHog, Shopify, Linear, …) and for arbitrary custom systems, **with zero Composio involvement**.
- The builder agent can configure a trigger end-to-end from a plain-language request: choose webhook recipe, register upstream, generate filter/transform, test against real deliveries, fix, done.
- Secrets (signing secrets, bot tokens, API keys) **never enter the agent's context or the chat transcript** — neither when the user provides them nor when the platform generates them.
- AI-configured triggers are visually and operationally first-class: same catalog, same drawers, provider logos, same deliveries debugging.
- Composio remains available and unchanged; both provider kinds coexist behind the same subscription/delivery model.

## Non-goals (this iteration)

- Polling providers (including "poll an MCP tool on a schedule") — designed for, explicitly deferred to v2. Egress-only polling matters for firewalled self-hosts, but webhooks cover the most-requested providers first.
- MCP actions-plane work (credential store for MCP servers, activating the `mcps` field) — separate track.
- Adopting the MCP triggers extension — not yet in the spec; the provider seam is where it will plug in later.
- Marketplace/community-contributed recipes — recipes ship curated in-repo first.

## Key decisions

### D1. New provider behind the existing seam, not a parallel system
The webhook provider is a second adapter in `TriggersGatewayRegistry`, and subscriptions/deliveries/catalog/test endpoints are reused as-is. Rationale: the pipeline (dedupe, dispatch, delivery logs, start/stop lifecycle) is provider-agnostic already; a parallel system would fork the UX and the agent ops. Consequence: `connection_id` must become provider-dependent (see open question Q2).

### D2. Verification is a small closed set of schemes, not per-provider code
Five schemes cover essentially every mainstream provider:

| scheme | covers |
|---|---|
| `hmac_sha256_header` (`X-Hub-Signature-256`-style) | GitHub, Shopify, Linear, Cal.com, Typeform, … |
| `stripe_signature` (`t=…,v1=…` HMAC over `t.rawbody`, tolerance window) | Stripe |
| `static_token_header` | Telegram (`X-Telegram-Bot-Api-Secret-Token`), many SaaS |
| `challenge_handshake` (echo challenge on first request) | Slack Events API, Dropbox, MS Graph |
| `none` (+ optional IP allowlist) | PostHog destinations, internal systems, cron |

Everything else about a provider (payload shape, registration, event filtering) is **configuration the agent generates**, not platform code. This is what makes the marginal cost of a new integration ~zero.

### D3. Transforms are sandboxed expressions, not arbitrary code
Filter, transform, and dedupe-key are expressions (JSONata or CEL — Q1) evaluated server-side over the verified payload. Rationale: agent-generated artifacts must be safe to run in the API process, cheap to evaluate per delivery, and displayable/editable in the UI. Arbitrary JS/Python would require a sandbox runtime and complicate self-hosting.

### D4. Secrets never transit the conversation
The agent operates on secret **references** (vault slugs), never values. Three mechanisms (full spec in `secrets-and-ux.md`):
1. `request_secret` op → renders a secure form in the chat UI; the browser posts the value directly to the vault API; the agent receives only `{slug}`.
2. Platform-generated signing secrets are created server-side inside `create_webhook_subscription`; verification reads them from the vault at ingress; the agent never sees them.
3. Provider-side registration that needs the secret (e.g. GitHub create-hook) happens **server-side** in the provider adapter (the `ensure_webhook_registered` pattern already exists for Composio) — secret goes platform→provider directly.

For manual-registration providers (no API), the UI shows the URL + secret in a reveal-once panel for the *user* to copy — displayed by the frontend from the vault endpoint, never echoed by the agent.

### D5. Recipes are catalog data, so the existing UI renders them
A recipe = `{integration_key, name, logo, verification_scheme, registration: api|manual, registration_hint, event_examples, docs_url}`. Served through the existing `/triggers/catalog/providers/{provider_key}/…` endpoints under provider key `webhook`, so `TriggerCatalogDrawer`/`AppLogo` show them exactly like Composio integrations. A generic "Custom webhook" entry covers the long tail.

### D6. Ingress URLs must be unguessable independent of verification
`POST /triggers/hooks/{ingress_token}` where `ingress_token` is a random opaque token (not the subscription UUID) — defense in depth for `none`-scheme subscriptions and against enumeration.

## Open questions

- **Q1 — Expression language**: JSONata (friendlier for JSON reshaping; `jsonata-python` maturity to verify) vs CEL (`cel-python`; better sandboxing story, clunkier for object construction). Recommendation: JSONata for transform, boolean JSONata for filter, single library. Needs a spike.
- **Q2 — `connection_id` optionality**: make it nullable for webhook subscriptions, or auto-create a synthetic gateway connection per webhook subscription so downstream code paths keep their invariant? Leaning synthetic connection (keeps `gateway_connections` scoping/permissions uniform), but needs a look at how much code assumes Composio-shaped connection data.
- **Q3 — Ingress deployment surface**: same FastAPI app vs the dedicated dispatcher entrypoint (`entrypoints/dispatcher_composio.py` precedent)? Ingress must read the **raw body** before JSON parsing (signature verification) and should be rate-limited; a dedicated router in the same app is likely enough for v1.
- **Q4 — Recipe logos**: bundle SVGs in-repo (licensing review needed per logo) vs hotlink CDN URLs like the Composio catalog does. Leaning bundled, monochrome fallback monogram when absent.
- **Q5 — Retry semantics to the upstream sender**: return 2xx immediately after enqueue (recommended — providers like Stripe retry on non-2xx and disable endpoints that keep failing) and rely on our own delivery retries, vs propagating processing failures.
