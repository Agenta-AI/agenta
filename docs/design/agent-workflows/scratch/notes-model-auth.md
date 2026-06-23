# Notes: current model / provider / auth code (agent-workflows)

Review date: 2026-06-23. Reviewer: subagent, read-only.
Scope: is the model/provider/auth code that exists RIGHT NOW correct? Findings cite real
`file:line`. "Current reality" is what the code does today. "Proposed" is the
`provider-model-auth/` redesign (not yet built).

## Overall verdict

The current path **works for the happy case** (one provider key per project, the chosen
model's provider key present in the vault) but is **not correct as a security or
multi-account design**. Two real problems stand out:

1. It injects the **entire project vault** of provider keys into the harness on every run,
   not the one key the chosen model needs. (over-broad credential exposure)
2. There is **no provider concept** anywhere. The model is a bare string. Key selection is
   "dump them all and hope the harness picks the right one." No provider routing, no
   account selection, no custom endpoint.

Per-user/per-request scoping is **correct** (authorization is resolved per request, never
cached globally). Model override is **mostly correct** (it is applied and verified, with a
labelled fallback), not silently dropped. So the redesign is justified, but the current code
is not catastrophically broken; it is the loose, single-account MVP the redesign tightens.

---

## How the model is chosen and passed (Q1)

**Current reality: a bare string, no provider concept, applied post-hoc with fallback.**

- Config default `model` is a plain string, e.g. `"gpt-5.5"`
  (`services/oss/src/agent/config.py:21`, `:70-76`). `AgentConfig.model: Optional[str]`
  (`sdks/python/agenta/sdk/agents/dtos.py:323`). No `provider` field anywhere in the agent
  config or DTOs (grep for `ModelSpec`/`provider` in `sdk/agents/*.py` finds only tool
  providers and the `provider_key` vault kind, never a model provider).
- The string flows: request `parameters.agent.model`
  (`dtos.py:687` `_parse_agent_fields`) -> `AgentConfig.model` -> harness adapter copies it
  verbatim into `PiAgentConfig.model` / `ClaudeAgentConfig.model`
  (`adapters/harnesses.py:65`, `:90`, `:114`) -> wire field `"model"`
  (`utils/wire.py:50`) -> TS `request.model` (`services/agent/src/protocol.ts:210-211`).
- The runner applies it AFTER the session exists with `applyModel`
  (`services/agent/src/engines/sandbox_agent.ts:205`,
  `engines/sandbox_agent/model.ts:46-70`): it calls `session.setModel(wanted)`, and on
  failure parses the harness's allowed-values error and tries a suffix match
  (`model.ts:7-16`). If nothing matches, it logs and returns `undefined`, and **the harness
  keeps its own default model** (`model.ts:67-69`).

**Is there any provider concept? No.** The only place "provider" enters model routing is an
implicit harness->key-var guess in the runner: `harnessKeyVar = acpAgent === "claude" ?
"ANTHROPIC_API_KEY" : "OPENAI_API_KEY"` (`engines/sandbox_agent/run-plan.ts:91`). That guess
is used only to compute `hasApiKey` (whether to upload Pi's OAuth fallback), not to select
which key to inject. So a Pi run targeting a Gemini or Anthropic model still gets every key
dumped and relies on the harness to pick.

Verdict: **correct enough for single-provider use, structurally wrong for routing.** The
model is "provider-blind." A model like `claude-opus-4-8` selected under the Pi harness has
no path that says "this needs the Anthropic key"; it works only because the Anthropic key is
in the dumped env anyway.

---

## How credentials are resolved and injected (Q2)

**Current reality: whole-vault dump. Over-broad. Confirmed end-to-end.**

Resolution (Python, service side):

- `app.py:83` calls `resolve_secrets()` with no arguments.
- `resolve_secrets` == `resolve_provider_keys`
  (`sdks/python/agenta/sdk/agents/platform/resolve.py:35`,
  `platform/secrets.py:105-141`).
- It does `GET /secrets/` (`platform/secrets.py:121`), iterates **every** secret in the
  response, and for each `kind == "provider_key"` maps the provider kind to an env var via
  `_PROVIDER_ENV_VARS` and collects `{ENV_VAR: key}` (`secrets.py:132-141`). The chosen
  `model` is **never passed in and never consulted**. There is no model or provider filter.
- Dedup is "first wins": `env.setdefault(env_var, key)` (`secrets.py:140`). So two OpenAI
  keys -> the second is silently dropped (matches the redesign's "duplicate-key landmine,"
  though the line moved from the old `agent/secrets.py:71` into `platform/secrets.py:140`).

Backend side, what `GET /secrets/` returns:

- `list_secrets` (`api/oss/src/apis/fastapi/vault/router.py:101-141`) returns the **entire
  project vault** as `List[SecretResponseDTO]`, scoped only by
  `request.state.project_id`, cached per project. No model/provider filter parameter exists.
- The values are **decrypted**: `VaultService.list_secrets` runs under
  `set_data_encryption_key(...)` (`api/oss/src/core/secrets/services.py:52-59`) and the DTO
  carries the plaintext `provider.key` (`api/oss/src/core/secrets/dtos.py:17-23`,
  `StandardProviderSettingsDTO.key: str`). So the agent service pulls every plaintext
  provider key for the project on every run.

Injection into the harness (TS runner):

- The full `secrets` map rides the `/run` wire as `secrets: Record<string,string>`
  (`utils/wire.py:52`, `protocol.ts:194-195`).
- sandbox-agent backend: `Object.assign(env, plan.secrets)` puts **all** keys into the local
  daemon env (`services/agent/src/engines/sandbox_agent.ts:119`). For Daytona, the same map
  is spread into the sandbox env vars (`engines/sandbox_agent/daytona.ts:33-39`,
  `buildSandboxProvider` passes `plan.secrets` at `provider.ts:34`). The harness process
  therefore sees OpenAI + Anthropic + Gemini + ... keys regardless of the model it runs.

**Severity: HIGH.** A run for an OpenAI model still has the project's Anthropic, Gemini,
Groq, OpenRouter, etc. keys in its environment. A compromised or prompt-injected harness, a
custom code-tool subprocess, or a misbehaving MCP server can read all of them. This is the
single most important current-correctness/security issue. Evidence:
`platform/secrets.py:132-141`, `sandbox_agent.ts:119`, `daytona.ts:33-39`,
`vault/router.py:130`.

**One thing that IS correctly scoped:** code-tool and MCP env get only their **named**
secrets via `resolve_named_secrets` (`POST /secrets/resolve`,
`platform/secrets.py:29-78`), restricted to the requested set (`secrets.py:72-78`). That
path is least-privilege. The over-broad behavior is specifically the **provider-key**
(model auth) path, not the tool-secret path.

---

## Per-user vs global auth (Q3)

**Current reality: correct. Per-request, never global.**

- The backend credential is resolved per request: `PlatformConnection.authorization()`
  resolves lazily on each call, never caches (`platform/connection.py:108-110`, `:131-133`),
  and reads `inject({}).get("Authorization")` (`connection.py:86-93`).
- `inject` reads `TracingContext.get()` (`sdks/python/agenta/sdk/engines/tracing/
  propagation.py:74`, `:94-96`), which is a request-scoped context (ContextVar), so one
  caller's Authorization does not bleed into another's run. The fallback to the process
  `AGENTA_API_KEY` (`connection.py:95-97`) is the standalone-SDK case (the env key is the
  user's own).
- The backend enforces project scope from `request.state.project_id`, not from the body
  (`vault/router.py:130-132`). EE adds an explicit `VIEW_SECRET` permission check
  (`vault/router.py:103-115`). So a caller only ever reads their own project's vault.

The `list_secrets` cache is keyed by `project_id` (`vault/router.py:117-139`), which is a
project-scoped cache, not a cross-user leak.

**Caveat (runner-side, not backend-side):** the in-process Pi engine mutates
**process-global** `process.env` to inject keys, but it serializes runs and restores prior
env in a `finally` (`services/agent/src/engines/pi.ts:69-99`), so request A's vault keys do
not leak into request B. That is correct as written. The risk there is the inherited
baked-in dev key (see Q5, finding 3), not cross-request vault leakage.

Verdict: **per-user/per-request auth is implemented correctly.** This is a current behavior
to PRESERVE.

---

## Claude vs Pi auth differences (Q4)

**Current reality: API-key first, OAuth/login fallback. Mostly correct, some sharp edges.**

- The runner copies a fixed allowlist of provider auth from the sidecar process env into the
  daemon env: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `GEMINI_API_KEY`
  (`services/agent/src/engines/sandbox_agent/daemon.ts:78-88`). Vault keys are then overlaid
  on top (`sandbox_agent.ts:119`). So Claude can authenticate via `ANTHROPIC_API_KEY` (vault
  or baked) or a subscription token (`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_AUTH_TOKEN`) baked
  into the sidecar.
- Pi auth: if no provider key is available for the harness's key var
  (`hasApiKey = !!secrets[harnessKeyVar]`, `run-plan.ts:113`), the Daytona path uploads the
  dev's local Pi OAuth login (`auth.json` + `settings.json`) into the sandbox
  (`engines/sandbox_agent/daytona.ts:88-105`, `:127`). Local runs use the host's
  `PI_CODING_AGENT_DIR` login (`daemon.ts:71-74`).
- **File-based auth that rotates:** the redesign's research is right that Pi/Claude rotate
  their OAuth credential files. Today the code uploads a **snapshot** of `auth.json`
  (`daytona.ts:90-101`). For a short-lived Daytona run this is fine, but it is a frozen
  copy; it is never written back, and if the token has expired it is stale. This is a known
  limitation, not a crash. Severity: LOW-MEDIUM (only the self-managed-OAuth-in-sandbox
  case).

Verdict: **functionally correct for API-key auth.** The OAuth-file-snapshot upload is the
weak spot the redesign's `source: runtime` / "never store the rotating file" addresses.

---

## Concrete current-correctness risks (Q5), prioritized

### R1 - Whole-vault provider-key dump (over-broad exposure). Severity: HIGH.
Every project provider key is decrypted and injected into the harness env on every run,
regardless of the chosen model.
Evidence: `platform/secrets.py:132-141` (no model filter, returns all provider_key envs),
`sandbox_agent.ts:119` / `daytona.ts:33-39` (all keys into the run env),
`vault/router.py:130` (`GET /secrets/` returns the whole project vault, decrypted via
`core/secrets/services.py:52-59`).
Fix in redesign: `ResolvedModelAccess.env` carries one provider's vars only; service-side
`POST /vault/model-access/resolve` replaces the dump.

### R2 - No provider concept / provider-blind model routing. Severity: MEDIUM-HIGH.
The model is a bare string with no provider. Nothing maps "model X needs provider Y's key."
It works only because R1 dumps every key. Selecting a non-default-provider model under a
harness has no first-class routing; it depends on the harness's own resolution plus the
dumped env.
Evidence: `AgentConfig.model: Optional[str]` (`dtos.py:323`); the only provider inference is
the harness-name guess `run-plan.ts:91`; `applyModel` is a post-hoc `setModel` with a string
suffix match (`model.ts:7-16`, `:46-70`).
Fix in redesign: `ModelSpec { provider, model, params }` committed in the config; provider is
first-class and the resolver matches account provider to model provider.

### R3 - Inherited provider env is not cleared before applying the plan. Severity: MEDIUM.
On the sandbox-agent path the daemon env starts with the sidecar's baked provider keys
(`daemon.ts:78-88`), and vault keys are overlaid (`sandbox_agent.ts:119`). A baked dev key
for a provider the vault does NOT have stays visible to the run. There is no clear-then-apply
step on this path. (The in-process Pi engine DOES restore/delete per run at `pi.ts:80-92`,
but only for the keys present in `secrets`; a baked key absent from `secrets` is untouched.)
Evidence: `daemon.ts:78-88`, `sandbox_agent.ts:119`, contrast `pi.ts:69-99`.
Fix in redesign: security non-negotiable #5, "clear inherited provider env before applying."

### R4 - Duplicate keys for one provider: first silently wins (no forced choice). Severity: LOW-MEDIUM.
`env.setdefault(env_var, key)` means a project with two OpenAI keys silently uses the first
encountered. The completion path does the opposite (last wins,
`sdks/python/agenta/sdk/managers/secrets.py` provider loop), so the two paths disagree.
Evidence: `platform/secrets.py:140`.
Fix in redesign: multi-account by slug; error (do not guess) when multiple accounts and no
default/binding.

### R5 - Silent model fallback can mislead (degraded, not data-incorrect). Severity: LOW.
When `setModel` cannot honor the requested model, the run proceeds on the harness's default
model. This is intentional and is handled honestly for tracing: `applyModel` returns
`undefined` and the chat span is labelled generically rather than claiming the requested
model (`sandbox_agent.ts:202-205`, `:209`; `model.ts:67-69`). So it is NOT a silent
mislabel. But the user still gets a different model than asked, with only a stderr log
(`model.ts:67`). Not surfaced to the caller. This is a UX/observability gap, not a
correctness bug. Note: this is the opposite of "silently-dropped model override claimed as
applied"; the code is careful here.

### R6 - `AGENTA_CRYPT_KEY` defaults to `"replace-me"`. Severity: HIGH if shipped, but PRE-EXISTING / OUT OF SCOPE.
`api/oss/src/utils/env.py:410`. The vault data-encryption key has a weak default. Not
introduced by the agent feature; flagged by the redesign too (security non-negotiable #8).
Call out for a separate security follow-up.

---

## What is already CORRECT and should be preserved

- **Per-request, per-user authorization** (Q3). Lazy, never cached, request-scoped context,
  project scope from `request.state`, EE permission check. `connection.py:108-133`,
  `propagation.py:74/94`, `vault/router.py:103-132`.
- **Named tool/MCP secret resolution is already least-privilege** (only requested names,
  restricted to the requested set). `platform/secrets.py:29-78`. The model-auth path should
  move to this same shape.
- **Honest model labelling on fallback** (R5): the trace does not claim a model the harness
  did not run. `sandbox_agent.ts:202-205`, `model.ts:67-69`. Preserve this.
- **In-process Pi env restore discipline**: serialized runs + `finally` restore prevent
  cross-request vault-key leakage. `pi.ts:69-99`. The redesign should keep this and extend
  it to clear-then-apply.
- **Best-effort optionality**: an empty vault is valid (the harness falls back to its own
  login); a vault outage returns empty rather than failing the run.
  `platform/secrets.py:109-130`. Keep this for the self-managed (`source: runtime`) case.
- **The three-way split already exists in the ports** (agent identity / harness config /
  runtime). `RunSelection` is deliberately not part of the neutral `AgentConfig`
  (`dtos.py:364-387`). The redesign's `ModelSpec` (committed) vs `ModelAccessBinding` (on the
  run) lands cleanly on this existing seam.

---

## How the redesign maps to the current problems

| Current problem (this doc) | Redesign fix |
| --- | --- |
| R1 whole-vault dump | `ResolvedModelAccess.env` = one provider's vars; `POST /vault/model-access/resolve` replaces `resolve_provider_keys` |
| R2 provider-blind model string | `ModelSpec { provider, model, params }` committed; provider first-class; provider-match security rule |
| R3 inherited env not cleared | security non-negotiable #5: clear-then-apply on the runner |
| R4 first-wins dedup | multi-account by slug; error on ambiguity, no guessing |
| R5 silent model fallback | `getModel(provider, id)` exact match, no silent fallback (Pi/Codex/Claude table) |
| R6 weak crypt key default | explicitly flagged, OUT OF SCOPE (same call as this doc) |
| OAuth file snapshot (Q4) | `source: runtime` self-managed; never store the rotating file |

Behaviors the redesign explicitly preserves (and so should NOT regress): per-request auth,
the additive nature (prompts/completions untouched), best-effort optionality, the
agent-config-vs-run split.

---

## Doc-vs-code drift to be aware of (for whoever implements)

The redesign's `status.md` / `design.md` cite OLDER line numbers, because the code was
refactored after those docs were written:
- "`services/oss/src/agent/secrets.py:71`" (first-wins dedup) is now
  `sdks/python/agenta/sdk/agents/platform/secrets.py:140`. The service `secrets.py` is now a
  thin re-export (`services/oss/src/agent/secrets.py:1-12`).
- "`services/agent/src/engines/sandbox_agent.ts:309` / `:530`" (env copy / Daytona spread)
  are now split into `engines/sandbox_agent/daemon.ts:78-88` (process-env copy),
  `sandbox_agent.ts:119` (vault overlay), and `engines/sandbox_agent/daytona.ts:33-39`
  (Daytona spread).
- "`services/oss/src/agent/secrets.py:26-35`" (provider->env map, "incomplete and partly
  dead") is now `_PROVIDER_ENV_VARS` at `platform/secrets.py:93-102`.
The substance of every claim still holds against the current code; only the locations moved.

## Open questions for the user

1. Is the whole-vault dump (R1) acceptable as a stopgap until the resolver lands, or should
   a quick model-scoped filter be patched in first? A minimal fix is feasible without the
   full redesign: filter `resolve_provider_keys` to the chosen model's provider env var.
2. R3 (clear inherited env) and R6 (`replace-me` crypt key) are security items independent of
   the resolver redesign. Should they be split into their own fix now?
3. Is the OAuth-file snapshot upload (`daytona.ts`) used in any shipping path, or only the
   dev Daytona POC? If only POC, R4/OAuth concerns are lower urgency.
