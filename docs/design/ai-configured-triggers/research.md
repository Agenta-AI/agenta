# Research

Verified findings from the codebase (exploration pass, 2026-07-10, against `origin/main`). Paths are repo-relative. §-references are used from `plan.md`.

## §1. The provider seam already exists

- `api/oss/src/core/triggers/registry.py` — `TriggersGatewayRegistry`; providers register adapters here. Composio is the only one today.
- `api/oss/src/core/triggers/providers/composio/adapter.py` + `catalog.py` — the reference adapter to mirror: catalog listing, subscription lifecycle (`refresh`/`revoke`/`start`/`stop`), upstream registration.
- `api/oss/src/core/triggers/{service.py,dtos.py,interfaces.py,exceptions.py,utils.py}` — `TriggersService` orchestrates; `interfaces.py` defines the adapter contract; `service.py` contains `_validate_references` and `ensure_webhook_registered` (precedent for server-side upstream registration).
- Wiring: `api/entrypoints/routers.py:159-165` constructs DAO → adapter → registry → service → router → dispatcher → worker; `:276` calls `ensure_webhook_registered()` at startup.

## §2. Subscription data model

- `api/oss/src/apis/fastapi/triggers/models.py` + `core/triggers/dtos.py`: `TriggerSubscriptionCreate = {connection_id (required, uuid), data: {event_key (required), trigger_config?, inputs_fields?, references?, selector?}, name?, description?, flags?, tags?, meta?}`.
- **Gap**: `connection_id` is required and Composio-shaped → plan Q2 (nullable vs synthetic connection).
- `data` is where webhook-specific fields go: `verification`, `filter`, `transform`, `dedupe_key`, `ingress_token` (server-set), `recipe_key`.
- Connections are a shared gateway concept: `api/oss/src/core/gateway/connections/` (+ `gateway/catalog/`), table renamed in `oss000000002_rename_tool_connections_to_gateway_connections.py` — one connection can serve both tools and triggers.

## §3. Ingress + dispatch precedent

- Provider webhook ingress precedent: the `/composio/events/` route in `api/oss/src/apis/fastapi/triggers/router.py` (class `TriggersRouter`, routes added via `add_api_route`).
- Dispatch: `api/oss/src/tasks/asyncio/triggers/dispatcher.py` (delivery fan-out) and `api/oss/src/tasks/taskiq/triggers/worker.py`; dedicated entrypoint `api/entrypoints/dispatcher_composio.py`.
- Deliveries: `/deliveries`, `/deliveries/query`, `/deliveries/{id}` routes; DB in `api/oss/src/dbs/postgres/triggers/`; migration `oss000000003_add_trigger_subscriptions_and_deliveries.py` (+ `oss000000004_add_webhook_subscription_flags.py` — flags already anticipate webhook-ish state).
- Test endpoint exists: `POST /triggers/subscriptions/test` — extend for replay-through-transform rather than adding a new surface.

## §4. Secrets vault

- `api/oss/src/core/secrets/enums.py` — `SecretKind` already includes **`webhook_provider`** and `custom_secret`; `CustomSecretFormat = {text, json}`.
- Encryption: `api/oss/src/utils/crypting.py` — Fernet, key derived from `AGENTA_CRYPT_KEY` (SHA-256 → base64url); `encrypt()`/`decrypt()`.
- Storage: `api/oss/src/dbs/postgres/secrets/` — `secrets` table scoped by `project_id` + `organization_id`, unique `(project_id, slug)`.
- API: `api/oss/src/apis/fastapi/vault/router.py`; frontend calls `vault/v1/secrets`.
- Frontend secret entry (masked inputs): `web/oss/src/components/pages/settings/Vault/` (`Vault.tsx`, `ConfigureSecretModal/`, `NamedSecretTable/`), `web/oss/src/components/ModelRegistry/assets/LabelInput/index.tsx` (Ant `<Input.Password>` when `isPassword`).
- Prior design workspace: `docs/design/vault-named-secrets/` — the v2 direction (named secrets, references) builds on this.

## §5. Frontend triggers UI

- Settings page: `web/oss/src/components/pages/settings/Triggers/Triggers.tsx` + `components/{GatewaySchedulesSection,GatewaySubscriptionsSection,GatewayTriggersSection}.tsx`.
- Drawers: `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/` — `TriggerSubscriptionDrawer.tsx`, `TriggerScheduleDrawer.tsx`, `TriggerCatalogDrawer.tsx`, `TriggerConnectDrawer.tsx`, `TriggerEventsDrawer.tsx`, `TriggerDeliveriesDrawer.tsx`; shared `drawers/shared/{RunVersionField,EventSourcePicker,ScheduleBuilderField}.tsx`.
- Logos: `AppLogo` component at `web/packages/agenta-entity-ui/src/drawers/shared/CatalogAppCard.tsx:48`; consumed e.g. `TriggerSubscriptionDrawer.tsx:1147`; logos are plain `logo` URL strings from catalog data (`TriggerCatalogDrawer.tsx:67`). **No bespoke icon registry** — recipes just need to supply `logo`.
- Entity/data layer: `web/packages/agenta-entities/src/gatewayTrigger/` (hooks `useTriggerCatalogIntegrations`, `useTriggerCatalogEvents`, `useTriggerSubscriptions`, `useTriggerDeliveries`, …; `core/` has `eventMessageTemplate.ts`, `selectorPreview.ts`, `messageInputs.ts`).
- Generated client: `web/packages/agenta-api-client/src/generated/api/resources/triggers/`.

## §6. Builder-agent surface (where "skill instructions" live)

- `api/oss/src/core/workflows/build_kit.py` (~lines 29-40) — the op catalog the product's builder agent sees: `discover_triggers`, `create_schedule`, `create_subscription`, `list_schedules`, `test_subscription`, `remove_schedule`, `remove_subscription`, `commit_revision`, ….
- `api/oss/src/core/workflows/static_catalog.py` — companion prose (e.g. `:163-164` schedule-details guidance). This is the file `agent-instructions.md` drafts additions for.
- Runtime: `services/runner/` (`src/tools/{direct.ts,relay.ts}`, `src/engines/sandbox_agent/`); `services/runner/skills/` is currently empty — op definitions in the backend catalog are authoritative, so we extend those rather than adding runner-local skill files.
- Adjacent design docs worth reading: `docs/design/trigger-latest-binding/` (format exemplar + current op-catalog wording caveats), `docs/design/agent-workflows/projects/trigger-discovery-catalog/`, `docs/design/automations-ux-rework/`.

## §7. Tests

- Acceptance: `api/oss/tests/pytest/acceptance/triggers/` (`test_triggers_schedules.py`, `_subscriptions.py`, `_catalog.py`, `_connections.py`, `_ingress.py` — ingress test file already exists to extend).
- Unit: `api/oss/tests/pytest/unit/triggers/`; manual: `api/oss/tests/manual/triggers/try_composio_triggers.py`.

## §8. External facts the plan relies on

- Provider webhook registration APIs (agent- or server-callable): GitHub `POST /repos/{owner}/{repo}/hooks`; Telegram `POST /bot<token>/setWebhook` (with `secret_token`; **one webhook per bot** — surface this caveat); Stripe `POST /v1/webhook_endpoints` (signing secret `whsec_…` returned **only** in the create response — must be vaulted immediately).
- Stripe signature verification requires HMAC over the **raw request body** with a timestamp tolerance window → ingress route must read raw bytes before JSON parsing.
- Slack Events API requires echoing a `url_verification` challenge on registration → the `challenge_handshake` scheme.
- Providers (Stripe, GitHub) retry on non-2xx and may auto-disable persistently failing endpoints → ack-then-process (context Q5).
- MCP has no trigger primitive; the Triggers & Events WG incubates one at `modelcontextprotocol/experimental-ext-triggers-events` → v2 poll/MCP provider plugs into the same registry seam.
