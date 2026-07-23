# Plan: AI-configured triggers

Six phases, A to F. Each names exact files and is sized for a narrow subagent. Dependency order: A, then B, then C and D in parallel, then E, then F. v2 items are listed at the end and are explicitly out of scope for these phases.

**The invariant every phase must respect:** the existing subscription → dispatch → delivery pipeline and the Composio provider are untouched. Everything lands behind the `TriggersGatewayRegistry` seam and the existing API surface; a deployment that never creates a webhook subscription behaves byte-for-byte as today.

---

## Phase A: Backend — webhook provider + verified ingress

### A1. Provider adapter
Files: `api/oss/src/core/triggers/providers/webhook/adapter.py` (new), `.../webhook/__init__.py` (new).
- Implement the adapter contract from `core/triggers/interfaces.py` (mirror `providers/composio/adapter.py`, research.md §1): subscription create/start/stop/revoke, catalog hooks (Phase C).
- On create: mint `ingress_token` (256-bit urlsafe random, context D6), generate a signing secret when the recipe's scheme needs one, store it via the vault (`SecretKind.webhook_provider`, research.md §4) — the secret value never leaves the service layer.
- Register in `api/entrypoints/routers.py` next to the Composio adapter (`:159-165`).

### A2. Connection handling (resolves Q2)
Files: `api/oss/src/core/gateway/connections/…`, `api/oss/src/core/triggers/service.py`.
- Spike first: enumerate call sites assuming Composio-shaped `connection_id`. Then either make it nullable for provider `webhook` or auto-create a synthetic gateway connection per webhook subscription. Record the decision in `status.md` before implementing.

### A3. Ingress route
Files: `api/oss/src/apis/fastapi/triggers/router.py`, new `api/oss/src/core/triggers/ingress.py`.
- `POST /triggers/hooks/{ingress_token}`: resolve subscription by token; read **raw body bytes before any parsing** (research.md §8, Stripe); verify per scheme; handle `challenge_handshake` (echo Slack/Dropbox challenge without creating a delivery); ack 2xx immediately after enqueue (context Q5); enqueue into the dispatcher path from research.md §3.
- Rate-limit per token; 404 (not 401) on unknown token to avoid oracle behavior.

### A4. Verification schemes
File: `api/oss/src/core/triggers/verification.py` (new).
- The five schemes from context D2 as pure functions `(raw_body, headers, secret) -> Verdict`; constant-time comparison; Stripe timestamp tolerance (default 5 min). Secrets fetched via the secrets service by slug at ingress time.

### A5. Data model
Files: `api/oss/src/core/triggers/dtos.py`, `api/oss/src/apis/fastapi/triggers/models.py`, new migration in `api/oss/databases/postgres/migrations/core_oss/versions/`.
- Extend subscription `data` (research.md §2): `verification {scheme, secret_slug?}`, `dedupe_key?`, `recipe_key?`, server-set `ingress_token`. Never serialize secret values into `data`.

## Phase B: Filter / transform / replay

### B1. Expression engine (resolves Q1)
File: `api/oss/src/core/triggers/transform.py` (new).
- Spike JSONata (`jsonata-python`) vs CEL (`cel-python`); pick one for `filter` (boolean), `transform` (payload → `inputs_fields` dict), `dedupe_key` (string). Enforce timeout + output-size cap; evaluation errors produce a **failed delivery with the error recorded**, not a dropped event — the agent debugs from deliveries.

### B2. Apply in the delivery path
Files: `api/oss/src/tasks/asyncio/triggers/dispatcher.py`, `api/oss/src/core/triggers/ingress.py`.
- Order: verify → filter (drop-with-log when false) → dedupe (skip repeats within window) → transform → existing `inputs_fields` merge → dispatch. Store both raw payload and transformed result on the delivery for debugging/replay.

### B3. Replay
Files: `api/oss/src/apis/fastapi/triggers/router.py`, `api/oss/src/core/triggers/service.py`.
- Extend `POST /triggers/subscriptions/test` (research.md §3): accept `delivery_id` to re-run a stored raw payload through the subscription's *current* filter/transform, with `dry_run` (return result, don't dispatch). This endpoint is what makes the agent's iterate loop cheap and safe.

## Phase C: Recipe catalog + logos

### C1. Recipes
Files: `api/oss/src/core/triggers/providers/webhook/recipes.py` (new), assets under `api/oss/src/core/triggers/providers/webhook/logos/` (Q4).
- Curated list, launch set: GitHub, Telegram, Stripe, Slack (Events API), PostHog, Shopify, Linear, Cal.com, Typeform + generic "Custom webhook". Each: `{integration_key, name, logo, verification_scheme, registration: api|manual, registration_hint, event_examples, transform_hints, docs_url}`.
- `transform_hints` = known payload shapes / example filter+transform per common event, consumed by the agent (Phase D) and shown as UI presets (Phase E).

### C2. Serve through the existing catalog
Files: `api/oss/src/core/triggers/providers/webhook/adapter.py`, `api/oss/src/core/triggers/registry.py`.
- Expose provider key `webhook` through `/triggers/catalog/providers/…` and `/triggers/discover` (research.md §1, §3) so `TriggerCatalogDrawer` + `AppLogo` (research.md §5) render recipes exactly like Composio integrations — logos are just the `logo` field, no new icon machinery.

## Phase D: Agent ops + instructions

### D1. New ops
Files: `api/oss/src/core/workflows/build_kit.py`, `api/oss/src/core/triggers/service.py`.
- `create_webhook_subscription(recipe_key, event_description, filter?, transform?, references)` — returns ingress URL + verification state, never secret values.
- `register_webhook_upstream(subscription_id, target)` — server-side registration for `registration: api` recipes (GitHub create-hook, Telegram setWebhook, Stripe webhook_endpoints; research.md §8), following the `ensure_webhook_registered` precedent (research.md §1). Uses a vaulted token by slug; the secret goes platform→provider directly.
- `update_trigger_transform(subscription_id, filter?, transform?, dedupe_key?)`.
- `list_trigger_deliveries(subscription_id, limit)` and `replay_delivery(subscription_id, delivery_id, dry_run)` (wraps B3).
- `request_secret(name, description, kind)` — **does not accept a value**; signals the UI to render a secure form (secrets-and-ux.md §2); returns `{slug}` once the user submits.

### D2. Static-catalog prose
File: `api/oss/src/core/workflows/static_catalog.py`.
- Add the trigger-configuration guidance drafted in `agent-instructions.md` (decision table, configure→test→iterate loop, secrets guardrails). Keep wording consistent with the revisions underway in `docs/design/trigger-latest-binding/`.

### D3. Runner-side plumbing for `request_secret`
Files: `services/runner/src/tools/` (relay path), chat UI event handling (with E3).
- `request_secret` is a relay op that blocks on out-of-band user input, analogous to existing confirmation-style interactions.

## Phase E: Frontend

### E1. Sources + creation flow
Files: `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/shared/EventSourcePicker.tsx`, `TriggerCatalogDrawer.tsx`, `TriggerSubscriptionDrawer.tsx`.
- Webhook recipes appear as sources with `AppLogo`; subscription drawer for webhook subscriptions shows: ingress URL (copy), verification status (last verified delivery), filter/transform editors (with recipe presets from C1), and registration state.

### E2. Deliveries debugging
Files: `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/TriggerDeliveriesDrawer.tsx`, `web/packages/agenta-entities/src/gatewayTrigger/`.
- Show raw payload vs transformed `inputs_fields` side by side; "replay with current transform" button (B3); surface filter-dropped and verification-failed events distinctly.

### E3. Secure secret entry
Files: chat UI surface consuming runner events; reuse `ConfigureSecretModal` / `LabelInput` masked-input patterns (research.md §4).
- Render `request_secret` as an inline secure form in the chat: masked input, posts directly to `vault/v1/secrets` from the browser, then acks the op with the slug. The value never appears in the transcript, agent context, or run traces. Reveal-once panel for platform-generated signing secrets on `registration: manual` recipes. Full spec: `secrets-and-ux.md`.

### E4. API client regen
File: `web/packages/agenta-api-client/src/generated/api/resources/triggers/` (regenerated).

## Phase F: Tests + docs

### F1. Acceptance
Files: `api/oss/tests/pytest/acceptance/triggers/test_triggers_ingress.py` (extend), new `test_triggers_webhook_provider.py`.
- Per-scheme signature vectors (valid/invalid/replayed-timestamp), challenge handshake, filter/transform/dedupe through to delivery, replay endpoint, secret-never-in-responses assertions (grep API responses for secret values in tests).

### F2. Agent-loop QA
- Lab-style E2E (see `agent-creation-lab` kit): builder agent configures GitHub, Telegram, Stripe from one-sentence prompts against a live deployment; measure toolcalls-to-working-trigger. Reuse `.agents/skills/agent-workflows-qa` where applicable.

### F3. Docs
- Self-hosting guide: "Triggers without Composio"; per-recipe how-tos (incl. tunnel/reverse-proxy guidance for firewalled self-hosts); security notes (scheme table, raw-body, ack semantics).

---

## Later (v2) — designed-for, not built now

- **Poll provider**, including "call an MCP tool on a schedule + dedupe" — same registry seam; egress-only, so it covers firewalled self-hosts where inbound webhooks can't reach. One MCP connection then powers both actions and triggers.
- **Vault v2**: named secret references in trigger/tool configs with egress-time substitution (builds on `docs/design/vault-named-secrets/`), rotation, audit trail of which subscription read which secret.
- **MCP Triggers & Events extension**: when the spec lands, a native push adapter replaces/augments MCP-poll behind the same seam.
- Community recipe contributions + logo pipeline.
