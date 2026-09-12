# AI-configured triggers

## What it is

A new trigger provider — `webhook` — that lets users create event triggers for **any** service (GitHub, Telegram, Stripe, PostHog, internal systems, …) without going through Composio, with the builder agent doing the configuration work: picking the verification scheme, registering the webhook on the provider side, writing the payload→inputs transform, and iterating against real deliveries until it works.

## Why

Self-hosting users should not need a Composio account (a third-party SaaS and data processor) to use event triggers. The strategy is a two-plane split: **MCP covers the actions plane** (separate track), and **webhook/poll providers cover the events plane** — because MCP itself has no trigger primitive (an MCP Triggers & Events working group is incubating one; we align with it later). Composio stays as the managed option; nothing in this plan removes it.

## What's already there (the good news)

- The provider seam exists: `TriggersGatewayRegistry` with Composio as the only registered adapter.
- Subscriptions, deliveries, dispatcher, catalog, `/subscriptions/test` — all reusable unchanged.
- The vault already has a `webhook_provider` secret kind and Fernet encryption.
- The frontend catalog UI renders integrations from a `logo` URL field (`AppLogo`) — recipe logos slot straight in, so AI-configured triggers look like first-class integrations.
- The builder agent already has trigger ops (`discover_triggers`, `create_subscription`, …) in `build_kit.py` / `static_catalog.py` — we extend that surface, we don't invent a new one.

## What we'll build

1. **Webhook provider** (backend): signed ingress URL per subscription, ~5 verification schemes, raw-body handling, dedupe, feeding the existing deliveries pipeline.
2. **Filter/transform step**: sandboxed expressions (not arbitrary code) that shape raw payloads into `inputs_fields`, plus delivery replay so transforms can be iterated safely.
3. **Recipe catalog**: curated per-provider metadata (logo, verification scheme, registration hints, example events) served through the existing catalog endpoints so the UI needs almost nothing new.
4. **Agent ops + instructions**: new build-kit ops and static-catalog prose so the builder agent can do the whole setup loop — including a `request_secret` op so **secrets never pass through the conversation**.
5. **Frontend UX**: webhook sources in the existing drawers, transform editor, delivery debugging, and the secure secret-entry flow.

## What it looks like when done

A self-hosted user types "run this agent when someone messages my Telegram bot". The agent asks for the bot token via a secure form (value goes to the vault, not the chat), calls `setWebhook` server-side, generates the transform, has the user send a test message, verifies the delivery, and the trigger shows up in the Triggers page with the Telegram logo — indistinguishable from a Composio-backed one.

## Read the rest in this order

1. `context.md` — goals, non-goals, key decisions and trade-offs
2. `research.md` — verified code findings with file paths
3. `plan.md` — implementation phases A–F with exact files
4. `agent-instructions.md` — the drafted op descriptions and static-catalog prose ("skill instructions") for the builder agent
5. `secrets-and-ux.md` — secret handling (v1 vault, v2 direction) and the UI/UX spec
6. `status.md` — current state and questions waiting on the owner
