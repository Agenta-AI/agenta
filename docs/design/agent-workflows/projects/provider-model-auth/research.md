# Research

Two halves: what Agenta does today (with file:line), and what the three harnesses do (with
source citations). The findings drive [design.md](design.md).

---

## Part 1: Agenta today

### 1.1 The agent runtime has no provider concept

The neutral config carries a bare model string and nothing else about provider or auth.

- `AgentConfig.model: Optional[str]` is the only model field. There is no `provider`,
  `base_url`, `api_key`, or `connection` anywhere in the agent DTOs.
  (`sdks/python/agenta/sdk/agents/dtos.py:315`)
- `HarnessAgentConfig.model: Optional[str]` carries it per harness; secrets are a flat env
  map (`sdks/python/agenta/sdk/agents/dtos.py:403`).
- `SessionConfig.secrets: Dict[str, str]` is described as "provider keys injected as harness
  env, never written to the agent filesystem." It is a pre-flattened `{ENV_VAR: key}` map.
  (`sdks/python/agenta/sdk/agents/dtos.py:558`)
- The `/run` wire emits `"model"` and `"secrets"` as the only model/auth fields
  (`sdks/python/agenta/sdk/agents/utils/wire.py:50-51`;
  `services/agent/src/protocol.ts:194-210`).

### 1.2 The service dumps the whole vault as env, model-blind

`resolve_harness_secrets()` is the entire provider-auth logic on the service side:

- It takes **no model argument**. It fetches the whole vault with `GET {api_base}/secrets/`
  using the caller's `Authorization`, then injects every recognized provider key as its env
  var. (`services/oss/src/agent/secrets.py:38-72`, called arg-less at
  `services/oss/src/agent/app.py:100`)
- The provider->env map is a hand-maintained subset of 8 entries
  (`services/oss/src/agent/secrets.py:26-35`). It misses `cohere`, `perplexityai`,
  `deepinfra`, `anyscale`, `minimax`, `alephalpha`. `mistralai` is dead (the vault
  normalizes it to `mistral` on write). It ignores `custom_provider` secrets entirely, so no
  base URL ever reaches a harness.
- The only "which provider" decision in the runner is a harness-name guess:
  `const harnessKeyVar = acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"`,
  used only to decide whether to upload Pi's OAuth `auth.json` fallback.
  (`services/agent/src/engines/sandbox_agent.ts:812-813`, `:910`)

Consequence: if a project has both an OpenAI and an Anthropic key, both
`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are exported into every run regardless of the
model. That is broader secret exposure than the run needs, and it is the opposite of
least-privilege.

### 1.3 The vault models providers but not accounts

The vault is a project/org-scoped CRUD store of encrypted secrets.

- `SecretKind`: `provider_key`, `custom_provider`, `sso_provider`, `webhook_provider`.
  There is **no** `custom_secret` / named-secret kind in the live code; that concept lives
  only in the agent-tool-redesign notes, not the vault.
  (`api/oss/src/core/secrets/enums.py:4-8`)
- A **standard** key carries only `{kind: <provider>, provider: {key}}`. No base URL, no
  account label used in resolution. (`api/oss/src/core/secrets/dtos.py:17-23`)
- A **custom** provider carries `{url, version, key, extras}`, a `models[]` list, and a
  `provider_slug` that is filled from the secret's `Header.name`. Its addressable model id
  is the triple `f"{provider_slug}/{kind}/{model.slug}"`.
  (`api/oss/src/core/secrets/dtos.py:26-45`, `:166-174`, `:225-230`)
- Storage: one `secrets` table, the whole `data` JSON encrypted with pgcrypto
  `pgp_sym_encrypt` under a single global passphrase `AGENTA_CRYPT_KEY` (default
  `"replace-me"`). `kind`, `name`, `project_id` are plaintext. **The only uniqueness
  constraint is on `id`**, so the DB does not stop two OpenAI keys, but resolution does.
  (`api/oss/src/dbs/postgres/secrets/dbas.py:12`, `custom_fields.py:42-63`,
  `api/oss/src/utils/env.py:410`)
- Scope: LLM keys are project-scoped (the HTTP router always sets `project_id`); SSO is
  org-scoped. (`api/oss/src/apis/fastapi/vault/router.py`)

### 1.4 The completion path resolves model->provider->key in the SDK, not the API

For prompt workflows (not agents), LiteLLM is fed per-call kwargs resolved entirely in the
SDK. There is no LiteLLM call in `api/` at completion time.

- `model_to_provider_mapping` is a static dict in
  `sdks/python/agenta/sdk/utils/assets.py:249`, the inverse of a hardcoded
  `supported_llm_models` catalog. It is the `_standard_providers` lookup the resolver uses
  (`sdks/python/agenta/sdk/managers/secrets.py:7,180`).
- `get_provider_settings(model)` maps a model string to a provider, then to a stored key (and
  for custom providers, to `api_base`/`api_version`/`extras`), and returns
  `{model, api_key, ...}` kwargs spread straight into `litellm.acompletion`.
  (`sdks/python/agenta/sdk/managers/secrets.py:158`,
  `sdks/python/agenta/sdk/engines/running/handlers.py:2019`)
- Custom providers are forced to look OpenAI-compatible: the model is rewritten
  `"{slug}/custom/{model}"` -> `"openai/{model}"` and `url`->`api_base`.
  (`sdks/python/agenta/sdk/managers/secrets.py:147-150`)
- A pluggable `SecretResolver` already exists from the sdk-local-tools work (env default,
  vault adapter optional). It is the precedent for the model-access resolver.

### 1.5 What is weak, summarized

1. No provider concept in the agent runtime; provider is inferred three different ways in
   three places (vault `data.kind`, model-id prefix in Pi, harness-name guess in sandbox-agent).
2. "Inject every key" is model-blind and over-broad.
3. One usable key per standard provider; a second is silently shadowed
   (`sdks/python/agenta/sdk/middlewares/running/vault.py:375`,
   `sdks/python/agenta/sdk/managers/secrets.py:219`).
4. Custom providers and base URLs are unsupported on the agent path.
5. OAuth / subscription auth is not modeled; it is ad hoc and Pi-centric.
6. The provider->env map is incomplete and partly wrong.
7. Model selection is fuzzy string-matching with silent fallback to a different model, not
   resolution (`services/agent/src/engines/pi.ts:102-110`,
   `services/agent/src/engines/sandbox_agent.ts:507-527`).
8. The resolve path ships the full plaintext vault to the agent service every run.

---

## Part 2: The three harnesses

The single most important cross-cutting fact: **provider is first-class in all three**, and
**the env-var API-key plane is the one mechanism they all share and that is immutable**.
OAuth credential files, by contrast, are rewritten at run time by all three.

### 2.1 Model selection

| Harness | How model is chosen | Provider first-class? | Id format |
| --- | --- | --- | --- |
| Claude Code | `--model` / `ANTHROPIC_MODEL` / `model` in settings; SDK `ClaudeAgentOptions(model=...)` | Provider via backend flags, not in the id | `claude-opus-4-8`, aliases `opus`/`sonnet`; `us.anthropic.claude-...` on Bedrock |
| Codex | `model` and `model_provider` are **two separate keys**; SDK `ThreadOptions.model` | **Yes**, `model_provider` points at a `[model_providers.<id>]` block | bare name, e.g. `gpt-5.3-codex` (never `provider/model`) |
| Pi | a resolved `Model` **object** via `getModel(provider, id)`; `createAgentSession({ model })` | **Yes**, `Model.provider` field; large `KnownProvider` union | display id is `provider/id`, e.g. `openai-codex/gpt-5.5` |

Takeaway: normalize the neutral selection to a `{provider, model}` **pair**. Codex needs
them split; Pi needs a resolved object built from the pair; Claude needs the bare model plus
a backend flag. A combined `provider/model` string is fine on the wire if you split it on the
boundary. Watch the collision: in Pi, `openai` and `openai-codex` are different providers.

### 2.2 Provider / base URL / custom endpoints

- **Claude Code**: backend selection is by env flags: `CLAUDE_CODE_USE_BEDROCK=1`,
  `CLAUDE_CODE_USE_VERTEX=1`, `CLAUDE_CODE_USE_FOUNDRY=1`, plus `ANTHROPIC_BASE_URL` for a
  gateway, and per-backend base URLs (`ANTHROPIC_BEDROCK_BASE_URL`, etc.). Global env only;
  the Agent SDK passes them through `options.env`.
  (https://code.claude.com/docs/en/amazon-bedrock.md, .../google-vertex-ai.md, .../llm-gateway.md)
- **Codex**: `[model_providers.<id>]` blocks with `base_url`, `env_key`, `wire_api`
  (`responses` only now; `chat` deprecated), `query_params`, `http_headers`,
  `env_http_headers`. Provider blocks live in **global** `~/.codex/config.toml`; project
  files may not define providers or auth. Per-run you switch with `-c model_provider=...` or
  `--profile`. (https://developers.openai.com/codex/config-advanced,
  https://www.morphllm.com/codex-provider-configuration)
- **Pi**: every `Model` carries its own `baseUrl` and wire `api`. Custom endpoints come from
  `~/.pi/agent/models.json` (merged with built-ins) or, programmatically,
  `ModelRegistry.registerProvider(name, { baseUrl, apiKey, api, headers, oauth, models })`.
  First-class built-ins exist for `azure-openai-responses`, `google-vertex`,
  `amazon-bedrock`, OpenAI-compatible. All per-run when used as an SDK.
  (vendored `pi-ai/dist/model-registry.d.ts`, `providers/register-builtins.js`)

Takeaway: a neutral "custom connection" record (base_url, api/wire, api_version, headers,
region, extras) projects onto all three. Codex needs it written to global config or passed
via `-c`; Pi and the Agent SDK take it per-run.

### 2.3 Authentication, and the OAuth rotation problem

Every harness supports an **API key via env var** (immutable, stateless) **and** an **OAuth
subscription login stored in a file that the harness rewrites at run time**.

| Harness | API key env | OAuth file | Does the tool rewrite the OAuth file at run time? |
| --- | --- | --- | --- |
| Claude Code | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN` bearer, or `CLAUDE_CODE_OAUTH_TOKEN`) | `~/.claude/.credentials.json` (Linux, mode 0600) or macOS Keychain | **Yes.** Refreshes the access token on 401 / TTL and writes it back; documented race/corruption issues under concurrency |
| Codex | `OPENAI_API_KEY` / `CODEX_API_KEY` / provider `env_key` | `~/.codex/auth.json` (path moves with `CODEX_HOME`) | **Yes.** Docs: "Codex refreshes tokens automatically during use before they expire." Store mode `file`/`keyring`/`auto` |
| Pi | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`, `GEMINI_API_KEY`, ... (per-provider map) | `~/.pi/agent/auth.json` (path moves with `PI_CODING_AGENT_DIR`) | **Yes.** `auth-storage.js` checks `Date.now() >= cred.expires`, refreshes under a file lock, and `writeFileSync`s the new `{access, refresh, expires}`. API-key entries are static; only OAuth entries rotate |

Sources: https://code.claude.com/docs/en/authentication.md;
https://developers.openai.com/codex/auth; vendored
`pi-ai/dist/auth-storage.{d.ts,js}`, `dist/env-api-keys.js`, `dist/utils/oauth/index.js`.

Other relevant auth facts:

- **Cloud creds** (Bedrock/Vertex) ride the normal AWS/GCP credential chains
  (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, ADC). All three harnesses support them.
- **Credential helper scripts**: Claude's `apiKeyHelper` (called on TTL/401), Codex's
  `[model_providers.<id>.auth] command=...`, Pi's `AuthStorage.setFallbackResolver`. All
  three have an "ask an external program for a fresh token" hook. This is the clean place to
  plug a rotating-credential source if we ever need one.
- Pi's repo path already follows the right instinct: it injects provider keys as env vars and
  only copies `auth.json` as a last resort when no key is present
  (`services/agent/src/engines/pi.ts` `withRequestProviderEnv`,
  `services/agent/src/engines/sandbox_agent.ts` `uploadPiAuthToSandbox`).

### 2.4 Per-run vs global, and multiple accounts

- **Pi** is fully per-run instantiable: model, `AuthStorage`, `ModelRegistry`, everything is
  a constructor arg to `createAgentSession`. Multi-account is clean: pass a per-run in-memory
  `AuthStorage`, or point each run at a different `PI_CODING_AGENT_DIR`. No built-in profile
  concept; `auth.json` holds one credential per provider id.
- **Codex** is CLI-driven. Per-run knobs come via SDK `ThreadOptions` / `-c` / `--profile`.
  Providers and auth files are global. It **does** have `[profiles.<name>]` (each selecting a
  model + provider + settings), which is the closest built-in multi-account mechanism, but
  two keys for the *same* `openai` provider still means two provider blocks with different
  `env_key`, or swapping `CODEX_HOME`/`auth.json`.
- **Claude Code** has no named-profile concept. One active credential per process/env, chosen
  by precedence. Multi-account means separate env contexts.

Takeaway: do not lean on each tool's built-in profile system (only Codex has one). Lean on
**per-run env injection** and, where needed, a **per-run home/agent dir**. That is the lowest
common denominator and the most isolatable. Pi's in-memory `AuthStorage` is the best-case
target; env injection is the universal fallback.

### 2.5 ACP note

When a harness runs over ACP behind the sandbox-agent runner, auth is still env vars inherited by the
spawned process. There is no separate ACP credential channel. The runner sets
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` / base-URL env on the
daemon or sandbox, exactly as it does today. So an env-shaped injection plan is the right
neutral output regardless of in-process vs ACP vs Daytona.

---

## Part 3: Synthesis for the design

1. **Provider is first-class everywhere but absent in Agenta.** Add it.
2. **The env-var API-key plane is the universal, immutable substrate.** Make the neutral
   output a contract dominated by env, with optional base-URL/extras.
3. **OAuth files are mutable and self-rotating.** Never store a frozen `auth.json` as a
   secret and expect it to keep working. Run OAuth subscriptions self-managed (Agenta injects
   nothing), never as a stored snapshot.
4. **Multi-account is a naming problem.** The vault already has `Header.name`; make it
   load-bearing for standard providers too, and resolve to one account instead of
   deduping by provider kind.
5. **Least privilege is free once the model carries a provider.** Resolve the account for
   the selected provider only, and inject just that one credential.
6. **The harness adapter should stay credential-agnostic.** It already only sees `model` and
   an env `secrets` map. Keep it that way; upgrade those two fields, do not teach it about
   the vault.


## Part 4: 2026-06-24 route-free rework finding

Facts from the existing vault shape:

- `provider_key` secrets already carry a connection name (`header.name`), a typed provider
  (`data.kind`), and a key (`data.provider.key`).
- `custom_provider` secrets already carry a connection name (`header.name` / `data.provider_slug`),
  a deployment/provider kind (`data.kind`, e.g. `bedrock`, `vertex_ai`, `custom`), endpoint fields
  (`data.provider.url`, `data.provider.version`), auth/config extras, and model slugs with computed
  `model_keys` in the form `provider_slug/kind/model_slug`.
- The frontend stores custom-provider extras with the existing snake-case keys
  `api_key`, `aws_region_name`, `aws_access_key_id`, `aws_secret_access_key`, `aws_session_token`,
  `vertex_ai_project`, `vertex_ai_location`, and `vertex_ai_credentials`. A resolver must normalize
  these into the harness env names; it must not require uppercase env-var keys in vault JSON.

Claude Code findings:

- `ANTHROPIC_CUSTOM_MODEL_OPTION` skips Claude Code's model-id validation only for adding a custom
  picker entry. It does not make arbitrary models work. The configured backend still has to accept
  the string.
- For Bedrock and Vertex, Claude Code is configured through backend flags and credentials, then model
  ids are passed through via model settings/env. If a user selects `my-bedrock/bedrock/gpt-5.5`,
  Agenta should pass the selected id through and let the backend fail if unsupported. Agenta does not
  need to classify it as Sonnet/Opus/Haiku for v1.

Recommendation: keep `ModelRef`/`ResolvedConnection` internally, but replace the new vault resolve
route with a service/SDK catalog built from existing `/secrets/`. This gives least-privilege at the
harness boundary while preserving the old vault API and schema.
