# Design

This is the converged design. It adopts the vocabulary and the cuts from two Codex reviews
(an architecture pass and a CTO pass). The plain-language version is in
[explainer.md](explainer.md). The earlier first draft used different names
(`ModelRef`, `Connection`, `InjectionPlan`, `ConnectionResolver`) and put the account choice
in the wrong place; this page supersedes it.

The proposal in one sentence: split provider/model/auth into **three concerns**, keep model
intent portable in the agent config, keep the chosen account on the run (never in the
committed revision), and resolve the two into one least-privilege access contract that the
harness adapter consumes.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MODEL INTENT (portable)             part of the committed agent config    │
│   ModelSpec { provider, model, params }                                   │
│   no secret, no base_url, no account; translates to every harness         │
└───────────────┬─────────────────────────────────────────────────────────┘
                │
                │   chosen at run time (NOT committed):
                │   ModelAccessBinding { source, account_ref? }
                │   on the invoke request, or an environment default
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ACCOUNT RESOLUTION                  our infra, service-side               │
│   ModelAccessResolver.resolve(model, binding, ctx) -> ResolvedModelAccess │
│   ProviderAccount = a read/resolve view over the existing vault           │
└───────────────┬─────────────────────────────────────────────────────────┘
                │   ResolvedModelAccess { provider, model, deployment,
                │     credential_mode, env, endpoint }
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ INJECTION                           the existing Harness adapter          │
│   translates one ResolvedModelAccess into Pi / Codex / Claude             │
└─────────────────────────────────────────────────────────────────────────┘
```

The port question, answered: the **Harness adapter never sees a vault or an account**. It
consumes a neutral `ResolvedModelAccess`. The **mapping lives in a new `ModelAccessResolver`
port**, owned by the SDK as an interface and implemented by the service as a vault-backed
adapter, by the standalone SDK as an env adapter, and by an SDK user as a bring-your-own
adapter. This mirrors the existing tool-resolver split.

---

## Concern 1: model intent (portable, in the agent config)

Replace the bare `AgentConfig.model: str` with a structured spec. Keep string coercion so
`"gpt-5.5"` and `"openai/gpt-5.5"` still parse.

```python
class ModelSpec(BaseModel):
    provider: Optional[str] = None     # logical family: "openai" | "anthropic" | "google" | <custom-name>
    model: str                         # model id in that provider's namespace: "gpt-5.5", "claude-opus-4-8"
    params: Dict[str, Any] = {}        # neutral knobs all harnesses understand: reasoning_effort, ...

    # "openai/gpt-5.5" -> ModelSpec(provider="openai", model="gpt-5.5")
    # "gpt-5.5"        -> ModelSpec(provider=None, model="gpt-5.5")  (provider inferred downstream)
```

`ModelSpec` holds no secret, no base URL, no account. It describes intent, so it stays
portable across projects and harnesses. The committed workflow revision carries it. Codex
needs `provider` and `model` separately, Pi builds a `Model` object from the pair, and Claude
takes the bare model plus a backend flag. Research [research.md](research.md), Part 2.1.

### A portable default credential mode, but never a concrete account

The committed config may carry a portable **mode** that names no project-local id:

- nothing (the implicit default: use the project's default account for the provider), or
- `self_managed` (this agent brings its own credentials; Agenta injects nothing).

It must not carry a concrete account id or slug, for the reason in the next section.

---

## The run binding: which account (never committed)

```python
class ModelAccessBinding(BaseModel):
    source: Literal["project_account", "project_default", "runtime"]
    account_ref: Optional[str] = None   # slug or id; only for source == "project_account"
```

`source` meaning:

- `project_account`: use a specific stored account (named by `account_ref`).
- `project_default`: use the project's default account for the model's provider.
- `runtime`: inject nothing; the sandbox, sidecar, local env, or harness login already owns
  auth. This is the "self-managed" case.

Where the binding lives. **Not on `WorkflowRevisionData`.** That model is committed,
exported, and shared across projects. A concrete `account_ref` baked into it breaks the
moment a revision is reused elsewhere: an id is project-local, and a slug can resolve to a
different credential in another project. So the binding lives on the run:

- **Invoke request override** (playground and testing): a top-level field on the request,
  sibling to `data` / `references` / `selector` / `stream`. This is how a tester pins an
  account for one run.
- **Saved environment default**: environment or deployment configuration holds the default
  account for a deployed agent. This is the durable, per-environment choice (dev vs prod
  accounts fall out of this later).
- **The committed revision** carries at most the portable mode (`project_default` implicitly,
  or `self_managed`), never `project_account` with a concrete ref.

Resolution always uses the project from the request context, never a project id from the
body. See Security below.

---

## Concern 2: the ProviderAccount (a view over the existing vault)

A **ProviderAccount** is a named, reusable way to reach a provider with one credential. For
v1 it is a **read/resolve view over the existing `secrets` table**, not a new storage model
and not a new write path. This is the key cut: we get multi-account and custom-endpoint
naming without a vault rewrite.

```python
class ProviderAccount(BaseModel):
    slug: str                       # stable reference (from the secret's Header.name); NOT the display name
    display_name: str
    provider: str                   # logical provider served
    deployment: Deployment          # "direct" | "azure" | "bedrock" | "vertex" | "custom"
    endpoint: Optional[Endpoint]    # base_url, api_version, region, headers, extras (non-direct)
    is_default: bool = False
    # the credential value stays in the vault; ProviderAccount never exposes it over the API
```

How it maps onto today's vault:

- A standard `provider_key` secret reads as a `direct` ProviderAccount, `slug` from
  `Header.name` (or `"default"` for a legacy unnamed key), credential from `provider.key`.
- A `custom_provider` secret reads as a non-direct ProviderAccount, `endpoint` from
  `{url, version, extras}`, credential from `key`/`extras`, `slug` from `provider_slug`.

The vault storage shape, the `pgp_sym_encrypt` column, and the existing `/secrets` CRUD do
not change. Creating and editing accounts stays on the existing secrets UI and API. We add
only a read list and a resolve. Full `ProviderAccount` CRUD and a storage migration are
later work, not v1.

Multi-account falls out: a project holds `openai/default` and `openai/acme` side by side as
two `provider_key` secrets with different `Header.name`, and both resolve by slug. The only
behavior change is that we stop deduping by provider kind, so the second key stops being
silently dropped.

### Self-managed credentials (the OAuth case)

Research [research.md](research.md), Part 2.3 is unambiguous: Claude, Codex, and Pi all
**rewrite their OAuth credential file at run time** when the access token expires. Storing a
frozen `auth.json` as a secret is wrong, because it goes stale the moment the harness rotates
it, and a vault snapshot cannot be written back to the user's real login store.

So we never store the rotating file. The self-managed mode (`source: runtime`) covers it:
the credential lives outside Agenta (the user's own sidecar login, an env var, or a cloud
identity), and Agenta injects nothing. A managed-OAuth path that stores a long-lived refresh
token and mints access tokens through each harness's credential-helper hook stays deferred.

---

## Concern 3: ResolvedModelAccess and the resolver port

The resolver's output is one neutral, least-privilege contract:

```python
class ResolvedModelAccess(BaseModel):
    provider: str
    model: str                     # possibly rewritten for the deployment (e.g. a bedrock id)
    deployment: str = "direct"
    credential_mode: Literal["env", "runtime_provided", "none"]
    env: Dict[str, str] = {}       # the ONLY secret-bearing channel; one provider's vars, not the vault
    endpoint: Optional[Endpoint] = None   # base_url, api_version, region, headers, extras (non-secret)
```

`SessionConfig` gains `resolved_model_access`. The existing `secrets` field stays as a
compatibility alias for the plan's `env` during the transition, so nothing downstream breaks
on day one.

The port:

```python
class ModelAccessResolver(Protocol):
    async def resolve(
        self, *, model: ModelSpec, binding: Optional[ModelAccessBinding], context: RuntimeAuthContext
    ) -> ResolvedModelAccess: ...
```

Adapters:

- `VaultModelAccessResolver` (service): calls a new **`POST /vault/model-access/resolve`**
  that takes `{model, binding}` and returns one `ResolvedModelAccess`, scoped to the caller's
  project. This replaces the whole-vault dump in `services/oss/src/agent/secrets.py`.
- `EnvModelAccessResolver` (SDK default, standalone): reads `OPENAI_API_KEY` etc. from the
  process env for the requested provider. Offline, no Agenta dependency.
- `StaticModelAccessResolver` (SDK bring-your-own): the SDK user passes a credential at
  instantiation. This is the "inject my own secrets" path.

The resolver is the future shared core for both agents and completions. We do **not** extend
the current LiteLLM-shaped `SecretsManager.get_provider_settings` to get there; that function
returns LiteLLM kwargs, reads route/run context, shadows duplicate keys, and rewrites custom
models into OpenAI-compatible strings. v1 serves agents only. A later step migrates the
completion path onto this resolver. See "Relationship to LiteLLM."

### How each harness consumes the contract

The harness adapter (`adapters/harnesses.py` plus the TS engines) translates
`ResolvedModelAccess`. It never sees a vault, an account, or a binding.

| Contract field | Pi | Codex | Claude Code |
| --- | --- | --- | --- |
| `provider` + `model` | `getModel(provider, id)` then `createAgentSession({ model })`; exact match, no silent fallback | `model` + `model_provider` | `--model` / `ANTHROPIC_MODEL`; provider via the flags below |
| `env` (api key) | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / ... or `AuthStorage.setRuntimeApiKey` | `OPENAI_API_KEY` or the provider block's `env_key` | `ANTHROPIC_API_KEY` |
| `endpoint.base_url` | `Model.baseUrl` / `registerProvider({ baseUrl })` | `[model_providers.<id>].base_url` | `ANTHROPIC_BASE_URL` |
| `deployment` azure/bedrock/vertex | provider `azure-openai-responses` / `amazon-bedrock` / `google-vertex` + creds | `model_providers` base_url + `query_params` + AWS/GCP env | `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` + AWS/GCP env |
| `credential_mode = runtime_provided` | inject nothing; do not upload a fallback `auth.json`; harness uses its own login | inject nothing; uses `~/.codex/auth.json` | inject nothing; uses `.credentials.json` / inherited `CLAUDE_CODE_OAUTH_TOKEN` |
| `credential_mode = none` | inject nothing | inject nothing | inject nothing |

All three harnesses agree on the env-var key plane and treat provider as first-class, so one
contract covers them. Each adapter absorbs its own differences (Codex needs a global config
block, Claude needs a backend flag, Pi can take it in-process).

---

## Security non-negotiables

1. **Project from the request context, never the body.** Resolve an account by
   `(request.state.project_id, provider, account_ref)`. A request must not pass a project id
   and reach another project's accounts.
2. **Provider match.** The resolved account's provider must equal `ModelSpec.provider`.
   Reject a binding that points an OpenAI model at an Anthropic account.
3. **Resolve is service plumbing, not a secret reader.** `POST /vault/model-access/resolve`
   returns a plaintext credential in its `env`. It must not be callable from the browser as a
   general secret-read API. Only the agent service calls it, server-side.
4. **No secret values in logs, traces, errors, or the raw-JSON playground echo.** Traces carry
   provider, model, deployment, and the account slug that ran. They never carry `env`.
5. **Clear inherited provider env before applying the plan.** On Agenta-managed runs the
   runner must clear known provider env vars it would otherwise inherit, then apply only the
   resolved plan. Today sandbox-agent copies process-env provider keys
   (`services/agent/src/engines/sandbox_agent.ts:309`) and Daytona spreads `secrets` into the sandbox
   (`:530`); both need the clear-then-apply discipline.
6. **`runtime` gates off the OAuth fallback.** `credential_mode = runtime_provided` must
   inject nothing and must not upload Pi's fallback `auth.json`. The existing upload becomes
   an explicit-mode behavior, not a default.
7. **Audit every resolve**: provider, model, account slug/id, credential mode, user, project.
   Never the key material.
8. **Flagged, not fixed here.** `AGENTA_CRYPT_KEY` defaults to `"replace-me"`
   (`api/oss/src/utils/env.py:410`). Out of scope; tracked in [status.md](status.md).

---

## The duplicate-key landmine (must handle in v1)

The two existing paths disagree on duplicate keys today. The agent path uses `setdefault`, so
the first key for a provider wins (`services/oss/src/agent/secrets.py:71`). The completion
path overwrites as it iterates, so the last key wins
(`sdks/python/agenta/sdk/managers/secrets.py:219`). A project may already hold two keys for
one provider.

So the v1 resolve must not silently "pick the default." Rules:

- Exactly one account for the provider: use it.
- A binding names an account: use that one.
- Multiple accounts, no binding, one flagged `is_default`: use the default and record which.
- Multiple accounts, no binding, none flagged: return a clear error asking the user to pick.
  Do not guess.

This preserves correctness and forces the choice into the open instead of inheriting an
accidental ordering.

---

## Backward compatibility with prompts and completions

Prompts and completions keep working, untouched. They resolve through the older
LiteLLM-shaped path that reads the same vault. We do not change that path, the vault storage,
or the `/secrets` API. We add an additive read view (provider accounts) and a service-side
resolve. The completion path never calls either. Existing keys read as accounts named from
their `Header.name`, or `"default"` when unnamed; no existing field changes meaning.

Later, both paths can share this resolver so a user configures accounts once. That migration
has its own plan and is not in this stack.

---

## Multi-account, end to end

1. A project holds two OpenAI accounts in the vault: `default` and `acme` (two `provider_key`
   secrets with different `Header.name`).
2. The agent config sets `model: { provider: openai, model: gpt-5.5 }`. The run binds an
   account: the playground sends `binding: { source: project_account, account_ref: acme }`,
   or a deployed environment holds that default.
3. `VaultModelAccessResolver.resolve` looks up `(project, provider=openai, acme)` and returns
   `{ credential_mode: env, env: { OPENAI_API_KEY: <acme key> }, model: gpt-5.5 }`.
4. The Pi/Codex/Claude adapter injects that one key. The other account, and every other
   provider's key, never enters the run.

With no binding and a single OpenAI account, the run uses it. With `source: runtime`, the
resolver returns `credential_mode: runtime_provided` and injects nothing.

---

## Relationship to LiteLLM

LiteLLM is the prompt-workflow completion path, not the agent path. Its current design is the
weak part: it keeps one key per provider via a dedup that shadows the second
(`sdks/python/agenta/sdk/managers/secrets.py:219`), uses a static model catalog
(`assets.py`), and forces custom providers to look OpenAI-compatible
(`secrets.py:147-150`). The resolver is the right place to unify both paths eventually. v1
builds it for agents and leaves completions on their path behind a compatibility read of the
same secrets. The unification is a separate, later step.

---

## Deferred, out of scope for v1

Codex's CTO pass named gaps worth deciding later, not building now:

- Full `ProviderAccount` storage model, write path, and CRUD endpoints.
- Managed OAuth (`OAuthCredentialRef`): a stored refresh token plus credential-helper minting.
- Cloud identity beyond today's custom `extras` (first-class Bedrock/Vertex plumbing).
- Cost and rate attribution per account, usage observability, audit log surface.
- Key rotation, disabled/revoked account state, and the resolver's failure behavior on a
  revoked key.
- Per-environment dev/prod default accounts, and team/org scope above project scope.
- LiteLLM proxy/gateway support, and the completion-path migration onto this resolver.
- Model allowlists/aliases per account, and slug-rename semantics.

---

## What changes, by file (preview for the plan)

- SDK DTOs and port: `ModelSpec`, `ModelAccessBinding`, `ResolvedModelAccess`,
  `RuntimeAuthContext`, the `ModelAccessResolver` Protocol, `EnvModelAccessResolver`,
  `StaticModelAccessResolver` (`sdks/python/agenta/sdk/agents/dtos.py`, `interfaces.py`, a new
  `model_access/` module).
- Wire: add non-secret fields (`provider`, `deployment`, `endpoint`, `credential_mode`) to the
  `/run` contract (`sdks/python/agenta/sdk/agents/utils/wire.py`,
  `services/agent/src/protocol.ts`) with golden-test updates.
- Service: `VaultModelAccessResolver`; new `POST /vault/model-access/resolve` and
  `GET /vault/provider-accounts` (read list); delete the whole-vault dump
  (`services/oss/src/agent/secrets.py`, `api/oss/src/apis/fastapi/vault/`,
  `api/oss/src/core/secrets/`).
- Run binding: a request-level binding field and an environment default
  (`api/oss/src/core/workflows/`, the invoke request models, `services/oss/src/agent/app.py`).
- TS engines: consume `ResolvedModelAccess`; exact model resolution; `runtime_provided`/`none`
  modes; clear-then-apply env; drop the harness-name->provider guess
  (`services/agent/src/engines/pi.ts`, `sandbox_agent.ts`).
- Frontend: provider/model + account override + self-managed toggle + raw-JSON escape hatch on
  the agent form.

The slicing is in [plan.md](plan.md).
