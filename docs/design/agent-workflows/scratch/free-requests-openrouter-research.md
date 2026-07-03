# Free requests, the Agenta key, OpenRouter, and agents: code trace

Read-only research. Every claim carries a `path:line` anchor. Verified against code on
2026-07-01. OSS vs EE differences are called out. Where the code did not let me confirm
something, I say so.

## Answers at a glance

**Q1 — the "free requests on our key" limit.** There are two independent limits.

1. The real per-request "free credits" gate is `check_entitlements(Counter.CREDITS_CONSUMED,
   delta=1)` in `api/oss/src/apis/fastapi/access/router.py:74-91`, reached only when a caller
   asks to use `resource_type == "local_secrets"` (the Agenta-provided env keys). It is
   **EE-only** (OSS returns `True` unconditionally at `access/router.py:77-78`). The free/hobby
   plan quota is **100 per calendar month per organization**, strict
   (`api/ee/src/core/access/entitlements/types.py:360-365`). The counter is a Postgres meter
   with a Redis/local cache.
2. A separate, coarser per-minute HTTP rate limiter (the EE `throttling_middleware`,
   `api/ee/src/middlewares/throttling.py:167`, wired at `api/entrypoints/routers.py:450-452`)
   token-buckets every request per organization by subscription plan. It is not LLM-specific.

**Caveat I could not fully resolve:** the SDK client that is supposed to *trigger* the
`local_secrets` credit check, `_allow_local_secrets` in
`sdks/python/agenta/sdk/middlewares/running/vault.py:126`, has **no caller anywhere in the
current tree** (grep confirms; `get_secrets` at `vault.py:282` does not call it). So in the code
as it stands, the completion path never hits the credit meter. Either the deployed
completion-service image runs an older SDK build where `get_secrets` called it, or the gate is
currently dormant. This needs live verification.

**Q2 — OpenRouter / DeepSeek and agents.** OpenRouter is a first-class provider everywhere
(vault kind `openrouter`, env `OPENROUTER_API_KEY`, Pi vault provider, and a full model list
incl. `openrouter/deepseek/deepseek-chat`). Provider keys live in the per-project **vault**
(`GET /secrets/`) or in process env; there is **no single central Agenta-owned key object** —
"our key" just means whatever `OPENROUTER_API_KEY`/`OPENAI_API_KEY`/etc. is set in the API/
completion-service **process environment** (`api/oss/src/utils/env.py:786-826`,
`sdks/.../running/vault.py:304-325`). The **playground** merges that process env with the project
vault (vault wins). The **running agent** is different: it resolves its model key from the
**project vault only** (`VaultConnectionResolver`, `services/oss/src/agent/app.py:44,165,169`),
not the container env — so there is no "Agenta pays" free-key path for agents today.

**Q3 — a ~20/month cap.** The window is **already monthly** and the counter already exists
(Postgres meter + Redis cache). Changing 100 to 20 is a one-line constant edit in
`api/ee/src/core/access/entitlements/types.py:360-365` (and the other plans). Making it
per-user instead of per-org is a one-field edit (`scope=Scope.USER`). So a monthly cap is a
config-value change, **not** a code change — but only takes effect once the `local_secrets`
trigger above is actually wired (see the Q1 caveat).

---

## Q1 — Free requests / the rate limit on "our API key"

### Q1.3 first — what "our API key" is

There is no single Agenta-owned provider key object. "Our key" = whatever provider keys are set
as **process environment variables** on the API/service host. Two readers:

- API side: `api/oss/src/utils/env.py:786-826` (`LLMConfig`) exposes `env.llm.openai`,
  `env.llm.openrouter`, ... each `os.getenv("<PROVIDER>_API_KEY", "")`. `openrouter` at
  `env.py:798`.
- The server-side merge helper `api/oss/src/core/secrets/utils.py`:
  - `get_system_llm_providers_secrets()` (`utils.py:39-51`) reads those env vars — the
    "Agenta-managed"/system keys.
  - `get_user_llm_providers_secrets(project_id)` (`utils.py:54-82`) reads the **project vault**
    (BYO).
  - `get_llm_providers_secrets()` (`utils.py:85-92`) merges them, **vault wins over system**
    (`return {**system_llm_secrets, **user_llm_secrets}`, `utils.py:92`).
  - NOTE: `get_llm_providers_secrets` currently has **no non-test caller** (grep). The live
    merge happens SDK-side instead (below).

- Service/SDK side (the actual completion runtime): the app process reads its **own** env vars
  as "local secrets" in `sdks/python/agenta/sdk/middlewares/running/vault.py:304-325`
  (`getenv(f"{provider.upper()}_API_KEY")` per provider kind), then fetches the project vault
  over HTTP at `vault.py:329-358` (`GET {api_url}/secrets/`), then merges with **vault winning**
  (`combined_standard = {**local_standard, **vault_standard}`, `vault.py:379`). So "our key" for
  the playground = the completion container's process env; "BYO" = the project vault.

### Q1.1 + Q1.2 — where the free-request limit is enforced, value, window

The enforcement point is a **resource-access check keyed to a metered credits counter**, not a
middleware or decorator on the LLM route:

- `api/oss/src/apis/fastapi/access/router.py:66-93` `_check_resource_access`:
  - `access/router.py:74` `if resource_type == "local_secrets":`
  - `access/router.py:77-78` `if not is_ee(): return True` — **OSS has no credit limit**.
  - `access/router.py:80-83` (EE):
    ```python
    check, meter, _ = await check_entitlements(
        key=Counter.CREDITS_CONSUMED,
        delta=1,
    )
    ```
  - `access/router.py:85-91` deny (`return False`) when over quota, else return the meter value.
- Reached via the endpoint `GET /access/permissions/check` (`access/router.py:100-104`,
  handler `check_permissions` at `:122`; resource step at `:210`
  `allow_resource = await _check_resource_access(resource_type=...)`).

Quota value + window (free/hobby plan), `api/ee/src/core/access/entitlements/types.py:360-365`:
```python
Counter.CREDITS_CONSUMED: Quota(
    free=100,
    limit=100,
    strict=True,
    period=Period.MONTHLY,
)
```
- **100 requests per calendar month, per organization** (no `scope=` set → org-scoped, per the
  `Quota.scope` doc at `types.py:97-98`). Other plans also cap credits at 100
  (`types.py:452,544,632`), i.e. the current credits number is the same across tiers.
- `Period.MONTHLY` honors a Stripe-style billing anchor day
  (`entitlements/service.py:207-233,261-264`; anchor from the subscription,
  `service.py:383,393`).

The credit is only ever decremented at **one runtime call site**: `access/router.py:81`
(`delta=1`). Grep for `CREDITS_CONSUMED` finds no other runtime consumer — credits are not
derived from token counts or tracing.

### The SDK trigger (and the caveat)

By design, the completion runtime asks permission to use the Agenta keys via
`sdks/python/agenta/sdk/middlewares/running/vault.py:126-279` `_allow_local_secrets`, which
`GET {host}/api/access/permissions/check` with `action=view_secret`,
`resource_type=local_secrets` (`vault.py:155-157`) and maps a 403 to
`"Out of credits. Please set your LLM provider API keys or contact support."`
(`vault.py:255-258`) and a 429 to `"API Rate limit exceeded..."` (`vault.py:227-231`).

**But `_allow_local_secrets` is not called anywhere** (repo-wide grep: only its definition).
`get_secrets` (`vault.py:282-391`) and `VaultMiddleware.__call__` (`vault.py:411-445`) do not
call it. So, in the current tree, nothing triggers the `local_secrets` credit check on the
completion path. Flagged for live verification.

### The second limit — per-minute HTTP throttle (EE)

Separate from credits: `throttling_middleware`
(`api/ee/src/middlewares/throttling.py:167-321`), registered at
`api/entrypoints/routers.py:450-452` (EE only; admin- and no-org requests bypass,
`throttling.py:168-178`). Per-organization GCRA/token-bucket in Redis
(`oss/src/utils/throttling.py:436` `check_throttle`), buckets by subscription plan. Over-limit →
`429` with `X-RateLimit-*`/`Retry-After` (`throttling.py:303-307`). Free/hobby buckets
(`entitlements/types.py:382-427`): STANDARD catch-all `capacity=480, rate=480`/min; AI_SERVICES
(`POST /ai/services/tools/call` only, `types.py:180-182`) `capacity=10, rate=30`. The playground
completion call is not in a named category, so it falls under STANDARD (480/min per org). This is
a request-rate guard, not a free-LLM quota.

### Q1.4 — full flow for a playground/completion call on the Agenta key

1. FE → API completion/service invocation route; EE `throttling_middleware`
   (`api/entrypoints/routers.py:450`) token-buckets per org.
2. Auth via `api/oss/src/middlewares/auth.py` (`use_api_key` at `:824`;
   `api/oss/src/services/api_key_service.py:143`).
3. The workflow app runs (SDK), and `VaultMiddleware`
   (`sdks/.../running/vault.py:411`) calls `get_secrets` (`vault.py:282`): reads local/env keys
   (`vault.py:304-325`) + project vault `GET /secrets/` (`vault.py:329-358`), merges vault-wins
   (`vault.py:379-381`) into `RunningContext.secrets`.
4. **Intended credit gate** (`_allow_local_secrets` → `GET /access/permissions/check?…
   resource_type=local_secrets` → `_check_resource_access` →
   `check_entitlements(CREDITS_CONSUMED, delta=1)`), `vault.py:126` +
   `access/router.py:74-91`. **Currently not invoked** (caveat above).
5. LiteLLM call in the SDK/service with the merged provider key (mock hook
   `sdks/python/agenta/sdk/litellm/mockllm.py:200`).

---

## Q2 — OpenRouter / DeepSeek, and agents

### Q2.5 — vault/secrets/connections storage; OpenRouter support

- Secret kinds: `api/oss/src/core/secrets/enums.py:4-9` (`PROVIDER_KEY`, `CUSTOM_PROVIDER`, ...).
- OpenRouter is a supported standard provider: `StandardProviderKind.OPENROUTER = "openrouter"`
  (`enums.py:30`) and `CustomProviderKind.OPENROUTER` (`enums.py:52`); env var mapping
  `LMProvidersEnum.openrouter = "OPENROUTER_API_KEY"`
  (`api/oss/src/models/api/evaluation_model.py:163`).
- Vault storage: Postgres via `VaultService`/`SecretsDAO`
  (`api/oss/src/core/secrets/services.py:11`, `api/oss/src/dbs/postgres/secrets/dao.py`); served
  at `/vault/v1` and `GET /secrets/` (`api/entrypoints/routers.py:1029`, `:844`).
- OpenRouter DeepSeek model ids exist in the shared catalog:
  `sdks/python/agenta/sdk/utils/assets.py:128-152`, e.g. `openrouter/deepseek/deepseek-chat`
  (`:137`), `openrouter/deepseek/deepseek-r1` (`:138`), `openrouter/deepseek/deepseek-v3.2`
  (`:140`). litellm routes `openrouter/*` natively.

### Q2.6 — using OpenRouter for the free-request path

For the playground, "use OpenRouter as our key" needs only `OPENROUTER_API_KEY` set in the
completion service's process env; `vault.py:307-325` already turns any `*_API_KEY` env into a
local provider secret, and litellm routes an `openrouter/...` model automatically. No routing
layer change is required — litellm is the model-routing layer
(`sdks/python/agenta/sdk/litellm/`). What you would additionally want is to make the credit gate
actually fire (Q1 caveat) so those OpenRouter calls are counted.

### Q2.7-Q2.9 — agent (Pi) defaults and key resolution

OpenRouter is a Pi-reachable provider: `PI_VAULT_PROVIDERS` includes `"openrouter"`
(`sdks/python/agenta/sdk/agents/capabilities.py:45-54`), and the harness model list is built
from the same `openrouter` catalog block (`capabilities.py:97-116`). Provider→env-var maps agree
across readers: `sdks/python/agenta/sdk/agents/connections/resolver.py:31-40` and
`sdks/python/agenta/sdk/agents/platform/secrets.py:93-102` both map `openrouter →
OPENROUTER_API_KEY`.

How the **running agent service** resolves its model key (verified via a parallel trace):
`services/oss/src/agent/app.py:44,165,169` calls `resolve_connection(model=model_ref, ...)` →
`sdks/python/agenta/sdk/agents/platform/resolve.py:95-109` → the connected
`VaultConnectionResolver` (`sdks/python/agenta/sdk/agents/platform/connections.py:441-493`). That
resolver reads the **project vault only** (`GET /secrets/`, `connections.py:472-473`), picks
exactly one connection deterministically, and returns a `ResolvedConnection` whose `env` carries
**only that one provider's key** (`connections.py:429-438`), mapped via `_PROVIDER_ENV_VARS`
(`connections.py:41-51`, `openrouter → OPENROUTER_API_KEY` at `:50`). The service threads it into
`SessionConfig.secrets` (`services/oss/src/agent/app.py:235-242`) for the harness subprocess env.
Important: the deployed agent path does **not** read the agent container's own process env keys —
it is vault-only.

Two other resolvers exist but are not the running-service path:
- Offline/SDK-standalone default `EnvConnectionResolver`
  (`sdks/python/agenta/sdk/agents/connections/resolver.py:43-97`): reads the **process env**
  (`agenta` mode, `:82-90`), or `runtime_provided`/harness OAuth fallback (`self_managed` at
  `:67-73`, absent key at `:91-97`). This is the SDK-only default when there is no platform.
- Legacy whole-vault dump `resolve_provider_keys`
  (`sdks/python/agenta/sdk/agents/platform/secrets.py:105-150`), marked DEPRECATED (`:114-121`),
  superseded by `VaultConnectionResolver`.

Agent auth vs the credit gate: the agent runner authenticates with
`GET /access/permissions/check?action=run_service&resource_type=service`
(`services/agent/src/sessions/auth.ts:23`). `resource_type == "service"` returns `True`
unconditionally (`api/oss/src/apis/fastapi/access/router.py:71-72`) — it never touches
`CREDITS_CONSUMED`. So **the agent path does NOT go through the free-request credit meter**; it
uses `resource_type=service`, not `local_secrets`.

So for Q2.9: an agent under the `agenta` connection today gets its key from the **project vault**
only, never from the agent container's process env and never from a metered central Agenta key. An
"Agenta-provided OpenRouter key for agents, counted against free credits" is **not** a path that
exists; it would require (a) seeding a shared/Agenta-owned OpenRouter secret that the resolver can
pick (or teaching `VaultConnectionResolver` to fall back to a system key), and (b) adding a
`local_secrets`/credits check into the agent key-resolution path (none exists — the agent only
checks `resource_type=service`).

### Agent defaults (confirmed)

- **Default harness = `pi_core`.** SDK: `sdks/python/agenta/sdk/agents/dtos.py:569`
  (`harness: str = "pi_core"`). FE: `web/packages/agenta-playground/src/state/execution/
  agentRequest.ts:259` (`harness: withSection(template.harness, {kind: "pi_core"})`).
- **Default model = none.** `sdks/python/agenta/sdk/agents/dtos.py:556`
  (`model: Optional[str] = None`). No global default; each config sets its own, else the harness
  uses its runtime default. (So there is no code-level "DeepSeek default" to change; you would set
  `model` to `openrouter/deepseek/deepseek-chat` in the default template/FE and seed the vault
  key.)
- **Default connection mode = `agenta`.** `sdks/python/agenta/sdk/agents/connections/
  models.py:61` (`mode: ConnectionMode = "agenta"`), i.e. the project's default vault connection.

---

## Q3 — feasibility of a ~20/month cap

- The window is **already monthly** (`Period.MONTHLY`, `entitlements/types.py:364`) with a
  billing anchor.
- Storage: authoritative counter in **Postgres** (`MeterDBA`: scope + period + `key/value/synced`,
  `api/ee/src/dbs/postgres/meters/dbas.py:9-21`; DAO `api/ee/src/dbs/postgres/meters/dao.py:95`),
  fronted by a two-tier cache (local 60s + **Redis** 24h) in
  `api/ee/src/core/access/entitlements/service.py` (`set_cache(..., ttl=24*60*60)`).
- To cap at 20/month: change `free`/`limit` from `100` to `20` in
  `api/ee/src/core/access/entitlements/types.py:360-365` (and the matching blocks at
  `:452,544,632` for the other plans if the cap should be global). Pure **config-value change**,
  EE only.
- To make it per-user rather than per-organization: set `scope=Scope.USER` on that `Quota`
  (`Quota.scope`, `entitlements/types.py:98`; `Scope.USER` at `:88`). One field.
- **Blocker to actually taking effect:** the `local_secrets` credit check must be triggered on
  the LLM path. Right now `_allow_local_secrets` (`sdks/.../running/vault.py:126`) is uncalled, so
  the meter never increments in the current tree. Wiring that call (or an equivalent server-side
  check on the completion route) is the code change needed before any monthly cap bites.
</content>
