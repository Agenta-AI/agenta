# Starter-credits bridge

A new organization signs up with no model provider key, so nothing runs until someone
pastes one in. The starter-credits bridge closes that gap. At signup the platform mints a
budget-capped key on a proxy the operator runs, and writes it into the new organization's
vault as a ready-to-use provider connection. The first run then works with no key form and
no configuration.

The bridge is deliberately small and deliberately temporary. It is EE only, inert unless a
deployment configures it, and it reuses the connection path that already ships instead of
adding a funded route of its own. When a first-class gateway owns funded traffic, the
bridge is removed.

## The path, end to end

1. **Signup.** A person signs up. The signup path creates their organization and its
   default project, then calls the EE hook `provision_signup_subscription`
   (`api/ee/src/core/organizations/service.py`), which calls
   `seed_starter_credits_bridge_safely`.
2. **Gates.** Seeding runs only when the deployment is armed (see
   [Configuration](#configuration)), the mint policy resolves, the proxy team's budget
   ceiling verifies, the organization has no seeded row already, and the mint policy
   allows this signup.
3. **Mint.** The service asks the proxy for one virtual key: a credential the proxy itself
   issues, carrying a spend ceiling, an allowlist of exactly one model, and per-key
   concurrency and throughput caps. The key's alias is the organization id, so a retried
   signup cannot mint twice.
4. **Seed.** The same call writes the key into the default project's vault as a custom
   provider connection, created `managed_by` the bridge and `write_only`. The connection
   stores the proxy's public base URL and the one model id.
5. **First run.** The SDK resolves the connection like any other custom provider, the
   runner pins that one model at that base URL, and the harness in the sandbox calls the
   proxy. The proxy checks the key, checks the budget, attaches the operator's upstream
   credential, and forwards the call.
6. **Exhaustion.** Once the organization's spend reaches the ceiling, the proxy refuses at
   admission. The runner classifies the refusal from the response body and returns a
   stable error code with a plain message, so the chat can tell the user to add their own
   key.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Seeding service | `api/ee/src/core/starter_credits_bridge/service.py` | The gates, the mint, the vault write, the velocity counters, the operator alert |
| Proxy admin client | `api/ee/src/core/starter_credits_bridge/client.py` | The master-keyed calls: generate a key, block a key, read team info |
| Mint policy and errors | `api/ee/src/core/starter_credits_bridge/types.py` | The `MintPolicy` model, the free-mail domain list, the development policy, the proxy error types |
| Signup hook | `api/ee/src/core/organizations/service.py` | The one call site, bounded and swallow-all |
| Configuration | `api/oss/src/utils/env.py` (`StarterCreditsBridgeConfig`) | The env contract and the `armed` predicate |
| Write-only secrets | `api/oss/src/core/secrets/redaction.py`, `api/oss/src/middlewares/auth.py` | Values a user can replace but never read back; the runtime reads plaintext through the `secret-resolve` grant |
| Managed secrets | `api/oss/src/core/secrets/managed.py` | Rows the platform owns, which users cannot edit or delete |
| SDK resolution | `sdks/python/agenta/sdk/agents/platform/connections.py`, `connections/errors.py` | Turns the connection into a provider configuration; raises `WriteOnlySecretError` when a caller without the grant gets a redacted key and no environment fallback |
| Endpoint validation | `sdks/python/agenta/sdk/agents/connections/endpoints.py` | Rejects any connection base URL that is not absolute HTTPS |
| Runner error classes | `services/runner/src/engines/sandbox_agent/errors.ts` | `RunErrorCode`, including `starter_credits_exhausted`, `starter_credits_program_paused`, `starter_credits_unavailable`, and `rate_limited` |

## Configuration

Every variable is read once into `StarterCreditsBridgeConfig`
(`api/oss/src/utils/env.py`). The bridge is `armed` only when `ENABLED` is true and both
proxy addresses, the master key, and the team id are all present. An unarmed deployment
returns from the seeding call immediately, which is what every OSS and self-hosted
deployment does.

| Variable (`AGENTA_STARTER_CREDITS_BRIDGE_` prefix) | Required to arm | What it holds |
| --- | --- | --- |
| `ENABLED` | yes | The opt-in switch. Defaults to false. Changing it takes a redeploy |
| `PROXY_PUBLIC_URL` | yes | The base URL stored on the seeded connection. A sandboxed run dials it from outside the deployment's network, so only the proxy's inference paths are published there |
| `PROXY_ADMIN_URL` | yes | The proxy's address on the private network. The minting client dials it, so the master key never crosses the public edge |
| `MASTER_KEY` | yes | The proxy's admin credential. It mints and blocks keys |
| `TEAM_ID` | yes | The proxy team every minted key joins. The team's own budget ceiling bounds total exposure, so seeding refuses to run without one |
| `MODEL_ID` | no | The single model id the minted key allowlists and the seeded connection publishes. Defaults to `vertex_ai/gemini-3.7-flash` |
| `POLICY_FLAG` | no | The name of the PostHog feature flag whose payload carries the mint policy. Defaults to `starter-credits-bridge-policy` |
| `ALERT_WEBHOOK` | no | An operator webhook. The service posts `{"text": ...}` to it on refusals and failures |

No policy value (grant size, velocity caps, per-key limits, domain rules) is configured
here. Those arrive in the policy payload. See
[Mint policy](design.md#the-mint-policy-comes-from-the-operator-not-from-source).

## Documents

| File | Answers |
| --- | --- |
| [design.md](design.md) | Every decision, the options it was chosen against, and why |
| [write-only-secrets.md](write-only-secrets.md) | The vault contract the seeded row depends on: write-only values and managed rows |
| [proxy-and-deployment.md](proxy-and-deployment.md) | What the proxy must look like, how it is routed, and what that constrains |
