# Plan

A stacked PR plan for the **minimal v1** from the CTO review. Each PR is reviewable on its
own, lands green, and does not regress current behavior until the slice that intentionally
replaces it. The stack lands neutral types first, then service resolution, then the run
binding, then the harness, then the frontend.

Do not start implementing until the design is signed off (see [status.md](status.md)). This
is the proposed shape, not a commitment. Names follow [design.md](design.md).

## Scope guardrails (what v1 does NOT build)

These are deliberately out of v1, per the CTO pass:

- No full `ProviderAccount` storage model, write path, or CRUD endpoints. Accounts are a read
  view over the existing `secrets` table; writes stay on the existing `/secrets` UI/API.
- No concrete account binding on `WorkflowRevisionData`. The binding rides the run.
- No managed OAuth (`OAuthCredentialRef`), no first-class cloud identity beyond today's custom
  `extras`, no completion-path migration.

## PR 1: Neutral types and the resolver port, no behavior change

**Goal:** land `ModelSpec`, `ResolvedModelAccess`, and the resolver port with string
back-compat, so nothing changes yet.

- Add `ModelSpec` (with `"provider/model"` and bare-string coercion) and wire it into
  `AgentConfig.model` and `HarnessAgentConfig.model`
  (`sdks/python/agenta/sdk/agents/dtos.py`).
- Add `ResolvedModelAccess` and put it on `SessionConfig`, keeping `secrets` as a
  compatibility alias for its `env`.
- Add the `ModelAccessResolver` Protocol, `RuntimeAuthContext`, `EnvModelAccessResolver`, and
  `StaticModelAccessResolver` in a new `sdks/python/agenta/sdk/agents/model_access/` module.
  Reuse the sdk-local-tools `SecretResolver` pattern.
- Add the non-secret contract fields to the `/run` wire on both sides and update golden tests
  (`utils/wire.py`, `services/agent/src/protocol.ts`, the wire tests).
- The service still produces today's env map, now through the resolver shape. No new endpoint.

**Acceptance:** existing agent and wire golden tests pass unchanged in meaning; `ModelSpec`
round-trips `"openai/gpt-5.5"` and `"gpt-5.5"`; a standalone run with `OPENAI_API_KEY` in env
resolves a plan carrying just that var.

## PR 2: Service resolve endpoint and least-privilege injection

**Goal:** resolve one account at a time and inject one credential. This is the security and
multi-account win.

- Add `GET /vault/provider-accounts`: a read list mapping existing `provider_key` and
  `custom_provider` secrets into `ProviderAccount` views (slug, provider, deployment,
  endpoint, is_default). Never returns key material.
- Add `POST /vault/model-access/resolve`: takes `{model, binding}`, scopes to
  `request.state.project_id`, returns one `ResolvedModelAccess`. Service-only, not a
  browser-callable secret reader.
- Implement the duplicate-key rules from [design.md](design.md): one account uses it; a
  binding names one; multiple with a flagged default use it; multiple with none flagged
  return a clear "pick an account" error.
- Point `VaultModelAccessResolver` at the endpoint. Delete the whole-vault dump
  (`services/oss/src/agent/secrets.py`). Stop deduping by provider kind.
- Audit each resolve (provider, model, account slug, mode, user, project; no key).

**Acceptance:** two OpenAI accounts coexist and resolve by slug; a run injects exactly one
key; `GET /secrets/` is no longer called on the agent path; a cross-project account ref is
rejected; resolving with two unflagged accounts and no binding returns the pick error.

## PR 3: The run binding (request override + environment default)

**Goal:** let a run choose an account without committing it to the revision.

- Add a top-level `ModelAccessBinding` field on the invoke request, sibling to
  `data`/`references`/`selector`/`stream`. Thread it into the resolver call in
  `services/oss/src/agent/app.py`.
- Add an environment/deployment default account (the durable per-environment choice). Resolve
  precedence: request binding, then environment default, then project default.
- Allow only the portable mode on the committed config (`project_default` implicitly or
  `self_managed`); reject a concrete `project_account` ref stored on the revision.

**Acceptance:** the playground can pin an account for one run; a deployed environment resolves
its default account; a committed revision never carries a concrete account ref.

## PR 4: Harness and runner consume ResolvedModelAccess

**Goal:** the adapters translate the contract; exact model; self-managed and none modes;
clear-then-apply env.

- `adapters/harnesses.py`: build harness config from `ModelSpec` + `ResolvedModelAccess`.
- TS engines: apply `provider`+`model` exactly (kill the silent fallback to a different
  model), apply `endpoint.base_url`, honor `credential_mode = runtime_provided`/`none` (inject
  nothing), clear inherited provider env before applying the plan, and drop the
  `acpAgent === "claude" ? ... : ...` provider guess (`engines/pi.ts`, `sandbox_agent.ts`).
- Gate Pi's OAuth `auth.json` upload behind `runtime_provided`, not the old `hasApiKey` guess.
- Custom endpoint delivery: Pi `registerProvider` / `Model.baseUrl`; Claude
  `ANTHROPIC_BASE_URL` (+ `CLAUDE_CODE_USE_*` for bedrock/vertex). Codex translation lands with
  the Codex harness if/when it exists; stub and note it.

**Acceptance:** a custom OpenAI-compatible base_url runs on Pi; `runtime_provided` runs with no
injected key and uses the harness login; an unknown model errors clearly instead of switching.

## PR 5: Minimal frontend

**Goal:** drive all of the above from the agent form without a redesign.

- Provider + model selector writing `ModelSpec`; a credential-source control (Use an Agenta
  account / Self-managed); an account picker fed by `GET /vault/provider-accounts` when "Agenta
  account" is chosen; a raw-JSON escape hatch for the exact payload.
- No change to the rest of the playground. Adding an account stays on the existing secrets UI.

**Acceptance:** a user picks a provider, model, and account, or toggles self-managed, or pastes
JSON, and the run uses exactly that.

## Cross-cutting: trace which account ran

Record the resolved account slug and credential mode on the workflow span (never the key), so
a run is reproducible and an operator can see which account paid. Land it with PR 2 or PR 4.

## Follow-ups (not in this stack)

- Migrate the LiteLLM completion path onto the resolver so prompts get multi-account and named
  accounts; retire the dedup-shadow (`sdks/python/agenta/sdk/managers/secrets.py:219`).
- Managed OAuth (`OAuthCredentialRef`): stored refresh token plus each harness's
  credential-helper hook.
- Full `ProviderAccount` storage, write path, and CRUD; first-class Bedrock/Vertex identity.
- Cost/usage attribution per account, audit surface, key rotation and revoked state,
  per-environment defaults, team/org scope.
- Encryption hardening: replace the `"replace-me"` `AGENTA_CRYPT_KEY` default.

## Test strategy

- SDK unit: `ModelSpec` coercion, `ResolvedModelAccess` shape, `EnvModelAccessResolver`,
  `StaticModelAccessResolver`.
- Wire golden: the new non-secret fields on both Python and TS sides, in the same PR.
- API unit: the provider-account read view; the resolve endpoint for direct, custom, and
  runtime; the duplicate-key rules; project-scope and provider-match rejections.
- Service unit: `VaultModelAccessResolver` against an httpx-mocked resolve endpoint;
  least-privilege (only the selected provider's vars come back).
- Engine (vitest): contract application for Pi and Claude, including `runtime_provided`/`none`,
  clear-then-apply env, and exact model resolution.
- Live acceptance (manual, existing feature-matrix harness): two OpenAI accounts, a custom
  base_url, and a self-managed (OAuth) run. See [../feature-matrix-test.md](../feature-matrix-test.md).
