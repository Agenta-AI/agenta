# Secrets & UX

Two coupled problems: (1) webhook triggers introduce secrets the platform must hold (signing secrets, provider tokens), and (2) the configuration is agent-driven, so the natural-but-wrong flow is the user pasting a token into the chat. The design principle: **the agent operates on secret references (vault slugs); secret values move only browser→vault and vault→provider, server-side.**

## 1. Secret inventory

| secret | who creates it | where it's used | agent visibility |
|---|---|---|---|
| Webhook signing secret (HMAC / static token) | platform, at subscription create | ingress verification; upstream registration payload | none — slug only |
| Provider API token (GitHub PAT, Telegram bot token, Stripe key) | user, via secure form | server-side `register_webhook_upstream` | slug only |
| Stripe endpoint secret (`whsec_…`) | Stripe, returned once at endpoint creation | ingress verification | none — vaulted server-side inside registration |

Storage: existing vault (`SecretKind.webhook_provider`, Fernet via `AGENTA_CRYPT_KEY`, project-scoped — research.md §4). No new storage system in v1.

## 2. The `request_secret` flow (agent asks, user answers out-of-band)

```
agent                    runner/chat UI                 browser                vault API
  │ request_secret(name,      │                            │                       │
  │  description, kind) ─────►│ render secure form ───────►│ user types value      │
  │                           │   (masked input, inline    │ POST vault/v1/secrets─►│ encrypt, store
  │                           │    in the chat thread)     │◄── {slug} ────────────│
  │◄── {slug} ────────────────│◄── ack(slug) ──────────────│                       │
```

Properties:
- The op schema has **no value parameter** — there is no way for the agent to receive the secret even if it asks wrong.
- The form posts directly to `vault/v1/secrets` from the browser; the value never enters the runner, the transcript, run traces, or observability spans.
- The rendered form reuses the existing masked-input patterns (`ConfigureSecretModal`, `LabelInput` with `Input.Password` — research.md §4) so it looks like the Vault settings page, signaling "this is a secure field, not a chat message".
- Cancel/timeout → the op returns `{declined: true}` and the agent proceeds or asks for an alternative (e.g. manual registration).
- If a user pastes a secret into chat anyway, the agent is instructed (agent-instructions.md §2) to not repeat it, recommend rotation, and re-route to the form. Optional hardening: transcript-side pattern redaction (`ghp_…`, `sk_live_…`, `xoxb-…`) before persistence — nice-to-have, not load-bearing.

## 3. Platform-generated secrets

- Created inside `create_webhook_subscription` in the service layer; vaulted immediately; API responses and op results carry `secret_slug` + scheme, never the value (asserted in tests, plan F1).
- `registration: api` recipes: the secret goes platform→provider inside `register_webhook_upstream` (GitHub hook `config.secret`, Telegram `secret_token`, …). Stripe inverts it: the platform captures `whsec_…` from the create response and vaults it in the same transaction.
- `registration: manual` recipes: the **user** needs the URL + secret to paste into a dashboard. The subscription drawer shows a **reveal-once panel** (fetches the value from a dedicated vault endpoint on explicit click, marks it revealed, offers regenerate). The agent's role ends at "I've created the endpoint — open the trigger panel to copy the URL and secret into <provider>."

## 4. UI spec

### Catalog & identity ("look like normal triggers")
- Webhook recipes appear in `TriggerCatalogDrawer` / `EventSourcePicker` with their provider **logo via the existing `AppLogo`** component — same grid, same cards as Composio integrations. A small "via webhook" badge (or provider-key subtitle) distinguishes the mechanism without ghettoizing it; `custom` gets a generic webhook glyph or a monogram.
- Subscriptions list (`GatewaySubscriptionsSection`) renders identically for both providers: logo, name, event, target, active toggle, last delivery.

### Subscription drawer (webhook-specific section)
- Ingress URL with copy button; verification scheme + status chip (`verified` after first valid delivery / `unverified` / `failing`); registration state (`registered via API`, `manual — pending`, with the reveal-once panel when manual).
- Filter / transform editors (code inputs with recipe presets from `transform_hints`), with a live preview against the latest delivery ("this payload → these inputs").
- "Configure with AI" entry point that opens the builder-agent chat scoped to this subscription — the same agent flow used at creation is available for repair.

### Deliveries drawer
- Raw payload and transformed `inputs_fields` side by side; distinct states for `verification_failed`, `filtered_out`, `transform_error`, `dispatched`; "replay with current transform" (dry-run) button. This is both the user's and the agent's debugging surface — one source of truth.

### Anti-goals
- No secret values in drawer state, entity atoms, or SWR caches — the reveal-once fetch bypasses the cache layer.
- No "paste your token here" free-text step anywhere in the chat flow.

## 5. v2 — vault evolution

- **Named secret references with egress substitution**: trigger/tool configs reference `{{secrets.NAME}}`; the platform substitutes at the moment of the outbound call (poll providers' HTTP requests, MCP server auth). Builds on `docs/design/vault-named-secrets/`. This becomes necessary when the poll provider lands (v2 in plan.md) — polling specs are agent-generated config that must mention credentials without containing them.
- **Rotation & audit**: per-secret last-used, which subscription/connection read it, one-click rotate with automatic upstream re-registration where `registration: api`.
- **Scoping**: today secrets are project-scoped; v2 should let a secret be attached to exactly one subscription/connection (least privilege), matching how the synthetic-connection decision (Q2) lands.
