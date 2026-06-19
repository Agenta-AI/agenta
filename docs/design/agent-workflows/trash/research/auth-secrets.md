# Research: Auth and Secrets for the pi.dev Agent Harness

Status: research only. No code changes. This file answers the five auth/secrets
questions for the agent-workflows feature (see
[`../README.md`](../README.md)). Every claim is cited. Items I could not verify
from a primary source are marked **UNVERIFIED**.

## Summary

- **pi is a local CLI/SDK, not a hosted service.** "pi.dev" is the marketing and
  docs site plus a package registry. There is no pi.dev account, no pi-issued API
  key, and no pi-managed model gateway. You authenticate to *model providers*, not
  to pi. ("Pi is a local coding agent. It runs with the permissions of the user
  account that starts it." — `security.md`.)
- **Provider auth is bring-your-own-key (BYOK) or provider OAuth.** pi reaches
  OpenAI/Anthropic/etc. with the user's own provider keys, or with a provider's
  subscription OAuth (Claude Pro/Max, ChatGPT Plus/Pro (Codex), GitHub Copilot).
  Keys live in env vars or `~/.pi/agent/auth.json`. There is no pi gateway in the
  middle, though pi can be *pointed at* a gateway you run (Cloudflare AI Gateway,
  OpenShell inference routing, a corporate proxy).
- **There is no first-class "secrets vault" in pi core.** pi has an *auth*
  concept (provider credentials) and a flexible key-resolution syntax
  (`$ENV`, `${ENV}`, `!shell-command`, literal). Anything beyond provider creds is
  just environment variables / files the host process already has. The "named
  secrets, scoped, agent-never-sees-the-value" feature surfaced in searches is a
  set of **third-party community extensions** (e.g. `pi-secret-guard`,
  `pi-secured-setup`, `pi-heimdall`, "Greywall"), not pi core.
- **The Codex secret has two shapes.** (a) Keep pi as the harness and use pi's
  native `openai-codex-responses` API + the built-in "ChatGPT Plus/Pro (Codex)"
  OAuth login — the credential is a pi `OAuthCredentials` object in
  `~/.pi/agent/auth.json`. (b) Swap the harness to the real **OpenAI Codex CLI**
  (`codex exec`), in which case the "codex secret" is either an `OPENAI_API_KEY`
  /`CODEX_API_KEY` value or a ChatGPT access token, materialized into
  `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) before the headless run.
- **For the Agenta feature: manage secrets in Agenta and inject them.** pi has no
  vault to delegate to. Agenta should store secrets at rest (encrypted), then the
  startup/secrets hook lays them into the sandbox as env vars and/or the right
  auth file. pi's observability layer is already designed to keep keys/headers/
  payloads out of traces by default — lean on that and verify it.

## 1. pi.dev auth model

### Authenticating to pi itself

There is nothing to authenticate to. pi is installed locally (npm/pnpm/bun/curl)
and runs as the local user. The only network calls pi makes on its own behalf are
version/telemetry pings to `pi.dev`, which are opt-out:

- `enableInstallTelemetry` -> `https://pi.dev/api/report-install`
- version check -> `https://pi.dev/api/latest-version`
- `PI_OFFLINE=1` / `--offline` disables all startup network ops;
  `PI_SKIP_VERSION_CHECK=1` disables the version check; `PI_TELEMETRY=0` disables
  the ping. (Source: `settings.md`, `usage.md`.)

So "auth to pi.dev" is not a concept we need to model. There is no pi account,
no pi org, no pi-issued token. (Source: `security.md`; `pi.dev` landing page.)

### How pi authenticates to model providers

Three mechanisms, with a defined precedence. From `sdk.md` (AuthStorage) and
`providers.md`:

1. CLI `--api-key <key>` flag (or SDK runtime override `setRuntimeApiKey`, not
   persisted).
2. `~/.pi/agent/auth.json` entry (API key **or** OAuth tokens). Stored with `0600`
   perms. Auth-file entries take priority over env vars.
3. Provider env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ...).
4. Fallback resolver for custom-provider keys from `models.json`.

`auth.json` is a flat object keyed by provider name. API-key shape
(`providers.md`):

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai":    { "type": "api_key", "key": "sk-..." }
}
```

Provider **OAuth / subscription login** is also first-class. `/login` (interactive)
supports Claude Pro/Max, **ChatGPT Plus/Pro (Codex)**, and GitHub Copilot. OAuth
tokens auto-refresh and persist in the same `auth.json` as an `OAuthCredentials`
object (`providers.md`, `custom-provider.md`):

```ts
interface OAuthCredentials {
  refresh: string;   // refresh token
  access: string;    // access token (what getApiKey() returns)
  expires: number;    // ms epoch expiry
}
```

So the answer to "pass-through provider keys, a pi-managed gateway, or both?" is:
**pass-through only.** No pi-managed gateway exists. pi *can* be pointed at a
gateway you operate — Cloudflare AI Gateway as a unified-billing/observability
proxy ([issue #3850](https://github.com/earendil-works/pi/issues/3850)), a
corporate proxy via `pi.registerProvider("openai", { baseUrl, headers })`
(`custom-provider.md`), or OpenShell inference routing where the gateway injects
upstream provider creds and the sandbox only sees `https://inference.local`
(`containerization.md`). Those are *your* gateways, not pi's.

## 2. Provider-key handling and the key-resolution syntax

This matters because it is how a secret gets indirected instead of pasted as a
literal. `apiKey`, custom header values, and `auth.json` `key` values share one
resolution syntax (`providers.md`, `custom-provider.md`):

- `!command` at the **start** of the value runs a shell command and uses its
  output (e.g. `"!security find-generic-password -ws 'anthropic'"`, or
  `"!op read 'op://vault/item/secret'"` for 1Password).
- `$ENV_VAR` and `${ENV_VAR}` interpolate environment variables.
- `$$` -> literal `$`; `$!` -> literal `!`.
- Otherwise the value is a literal.

Custom providers/proxies can carry secrets in headers using the same syntax:

```ts
pi.registerProvider("google", {
  baseUrl: "https://ai-gateway.corp.com/google",
  headers: { "X-Corp-Auth": "$CORP_AUTH_TOKEN" } // env var or literal
});
```

Implication for Agenta: we do **not** have to write raw secrets into pi config
files. We can inject env vars into the sandbox and reference them as `$VAR` in
pi's `auth.json`/provider config, or reference a secrets manager via `!command`.

## 3. Secrets concept + injection

### Is there a first-class "secrets" feature in pi core? No.

pi core has an **auth** concept (provider credentials, above) and project
**trust** (an input-loading guard for `.pi/` resources, not a secret store —
`security.md`). It does **not** ship a named-secret/vault/scoped-secret feature.
The "secrets with a value + allowed host patterns, where the agent never sees the
real value" model that searches surface is from **third-party extensions**, not
Earendil:

- `pi-secret-guard` — author **acarerdinc**, third-party. Scans `git commit`/
  `git push` via the `tool_call` event and blocks if secrets are detected;
  regex + LLM review. (Source: `https://pi.dev/packages/pi-secret-guard` package
  page.) This is a *leak-prevention* tool, not a secret *store*.
- `pi-secured-setup`, `pi-heimdall`, "Greywall" — third-party permission/redaction
  layers (community blogs; **UNVERIFIED** beyond existence — treat as ecosystem
  examples, not core).

Conclusion: if Agenta wants named, scoped secrets, Agenta owns that. pi gives us
the *injection surface* (env vars, files, `$ENV`/`!cmd` references), not a vault.

### How secrets reach a pi run and the tools inside it

Because pi runs as the local user with the local environment, **every secret a
tool sees is whatever is in the process environment / filesystem of the pi
process**. There is no per-tool secret broker in core. Built-in tools
(`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`) and extension tools run
"with the permissions of the pi process" (`security.md`). So a `bash` tool can
read any env var or file the process can. Scope is the *process/sandbox boundary*,
not a pi ACL.

This is exactly why the Agenta design runs pi in a **sandbox** (Daytona) and uses
**startup hooks** to lay down files then inject secrets — that sandbox *is* the
secret-scoping boundary. pi's own docs say the same: for unattended/untrusted
work, "run pi in a contained environment ... with only the files and credentials
required for the task" and "pass the minimum required API keys or use short-lived
credentials" (`security.md`, `containerization.md`).

### Where to inject (three concrete options, all supported by pi)

1. **Env vars in the sandbox** (simplest; matches pi's BYOK model). Set
   `OPENAI_API_KEY` etc. in the sandbox env; pi resolves them via precedence rule
   #3. The Docker example does exactly this: `docker run -e ANTHROPIC_API_KEY ...`
   (`containerization.md`).
2. **`~/.pi/agent/auth.json` file** laid into the sandbox (precedence #2, beats
   env). Either literal keys or `$ENV`/`!cmd` indirection. Note the doc warning:
   "Mounting your host `~/.pi/agent` exposes host auth and session files to the
   container." For a sandbox we generate a fresh `auth.json`, we do not mount the
   host's.
3. **Gateway / inference routing** (strongest isolation): the sandbox calls
   `https://inference.local` and a gateway injects the real provider key upstream,
   so "OpenShell providers can keep raw model API keys outside the sandbox"
   (`containerization.md`). This keeps the model key out of the sandbox entirely.

### Scoping per-agent / per-session

- **Per-agent**: each agent revision's secrets become that sandbox's env/auth
  files. Different agent => different sandbox => different secret set. pi's
  precedence model means a per-sandbox `auth.json` or per-sandbox env fully
  determines what that agent can use.
- **Per-session**: the SDK exposes `authStorage.setRuntimeApiKey(provider, key)`
  (runtime override, **not persisted**) and a "custom auth storage location"
  (`sdk.md`). A session can be given a short-lived key in memory without writing
  it to disk — useful for per-`session_id` credentials that should not outlive the
  run. **UNVERIFIED**: exact API for a fully custom per-session AuthStorage path
  beyond `setRuntimeApiKey` and the "custom auth storage location" mention.

## 4. The Codex secret (the swappable-harness question)

The README says the harness is swappable and could run OpenAI Codex instead of
pi's own loop. There are two genuinely different ways to do this, and the "codex
secret" means something different in each.

### Option A — keep pi as the harness, talk to the Codex backend through pi

pi already speaks Codex natively. `custom-provider.md` lists an API type
**`openai-codex-responses`** ("OpenAI Codex Responses API"), and `/login` offers
**"ChatGPT Plus/Pro (Codex)"** OAuth login ("Officially endorsed by OpenAI: Codex
for OSS", per `providers.md`). In this option:

- The "codex secret" is just a pi credential: either an `OPENAI_API_KEY` (env or
  `auth.json` `{"openai": {"type":"api_key","key":"..."}}`) for API-key access, or
  a pi `OAuthCredentials` object for ChatGPT-subscription Codex access.
- Injection is identical to any other pi provider (section 3). No separate Codex
  install needed. This is the lowest-friction path and stays inside pi's
  instrumentation/observability.

### Option B — swap in the real OpenAI Codex CLI as the harness

Here pi is replaced (or wrapped) by the `codex` CLI, run headless with
`codex exec`. The "codex secret" is Codex's own credential. How Codex authenticates
(OpenAI Codex docs):

- **ChatGPT login (default)** when no valid session exists — interactive, browser
  or device flow. Not suitable headless unless you transplant a token.
- **API key** — recommended for "programmatic Codex CLI workflows, such as CI/CD
  jobs" (`developers.openai.com/codex/auth`).
- **Access token** — ChatGPT-workspace token for "trusted, non-interactive
  workflows" (`developers.openai.com/codex/enterprise/access-tokens`).

Credential storage: `~/.codex/auth.json` (plaintext) or an OS keyring, controlled
by `cli_auth_credentials_store` = `file` | `keyring` | `auto`; the file lives
under `CODEX_HOME` (default `~/.codex`). Treat `auth.json` "like a password"
(`developers.openai.com/codex/auth`).

Headless injection patterns:

1. **Per-invocation API key (no persisted login):**
   ```bash
   CODEX_API_KEY=<api-key> codex exec --json "your task"
   ```
   Set it only for the single invocation, not as a job-level env var, "in workflows
   that execute untrusted code" (`developers.openai.com/codex/noninteractive`).
2. **Persisted API-key login (writes `auth.json`):**
   ```bash
   printenv OPENAI_API_KEY | codex login --with-api-key   # reads key from stdin
   codex login status   # -> "Logged in using an API key - sk-proj-***ABCD1"
   ```
   (`developers.openai.com/codex/auth`, simplified.guide.) Note: setting
   `OPENAI_API_KEY` env var **alone does not persist a login** — you must run a
   login command or use `CODEX_API_KEY` per invocation. A request to honor
   `OPENAI_API_KEY` without writing `auth.json` was closed "not planned"
   ([issue #5212](https://github.com/openai/codex/issues/5212)); the documented
   workaround is a custom `[model_providers.*]` with `env_key = "OPENAI_API_KEY"`.
3. **ChatGPT access token via stdin (subscription/workspace, headless):**
   ```bash
   printenv CODEX_ACCESS_TOKEN | codex login --with-access-token
   ```
   (`developers.openai.com/codex/auth`.)
4. **Transplant a prepared `auth.json`** generated on a machine that did the
   browser login, copied into `$CODEX_HOME/auth.json` in the sandbox (SSH/Docker
   copy pattern; `developers.openai.com/codex/auth`).

Custom-provider config (e.g. proxy/Azure) uses `config.toml` with `env_key` so the
secret is never checked into the dotfile (`developers.openai.com/codex/config-advanced`):

```toml
model = "gpt-5.4"
model_provider = "proxy"

[model_providers.proxy]
name = "OpenAI using LLM proxy"
base_url = "http://proxy.example.com"
env_key = "OPENAI_API_KEY"
```

Useful headless flags: `codex exec --json`, `--output-schema <path>`,
`--ephemeral` (don't persist session files), `--skip-git-repo-check`,
`--ignore-user-config`, `--sandbox <mode>` (`developers.openai.com/codex/noninteractive`,
`/codex/cli/reference`).

**Gotcha to design around:** Codex's API-key-via-env sign-in is blocked while a
ChatGPT subscription login is active in the same `CODEX_HOME`
([issue #3286](https://github.com/openai/codex/issues/3286)). For deterministic
headless runs give each agent run a clean `CODEX_HOME` and exactly one credential
mode.

### Recommendation on the Codex secret

Model a **harness-typed "codex secret"** in the agent config that can carry either
(i) an OpenAI API key or (ii) a ChatGPT access token, plus a target mode. The
startup/secrets hook then materializes it for whichever harness is selected:

- pi harness, `openai-codex-responses` -> write to pi `auth.json` / env as the
  `openai` credential.
- Codex CLI harness -> either export `CODEX_API_KEY` for the single `codex exec`,
  or render a fresh `$CODEX_HOME/auth.json`, or pipe a token to
  `codex login --with-access-token`.

This keeps the secret abstraction harness-agnostic and matches the README's
"swappable harness" requirement.

## 5. Security best practices

### Keeping secrets out of logs / traces / instrumentation

pi's observability design (`packages/agent/docs/observability.md`) already treats
this as a first-class concern. pi emits structured lifecycle events
(`pi.agent.prompt`, `pi.ai.provider.request`, `pi.agent.tool_call`, ...) that an
adapter turns into OTel/Sentry spans. The doc defines an explicit allow/deny list:

- **Safe by default** (emitted): provider, model, API id, session id, entry type,
  tool name, status code, stop reason, token counts, costs, durations.
- **Unsafe by default** (NOT emitted): prompts, completions, tool args, tool
  results, shell output, file contents, provider request payloads, provider
  response bodies, **API keys**, **headers**. "Content capture can be opt-in later
  with explicit redaction hooks."

So if Agenta maps pi observability events to its tracing/instrumentation, secrets
in keys/headers/payloads are excluded by default. **Action for Agenta:** verify our
adapter does not turn on content capture, and confirm we never log resolved
`auth.json` values or the sandbox env. Also: the `before_provider_request` /
`before_provider_payload` hooks can inspect/replace the outgoing payload, which is
the right place to add redaction if we ever capture content
(`packages/agent/docs/hooks.md`, `extensions.md`).

Additional bleed paths to guard (pi-specific):

- `!command` key resolution runs a shell; ensure the command itself does not echo
  the secret to a place pi captures.
- pi tools include `bash`; agent-run shell output is large and can contain secrets.
  pi keeps tool/shell output out of traces by default, but if we surface the
  multi-message agent output to users, scrub it.
- Do not mount the host `~/.pi/agent` into the sandbox (would leak host
  auth/sessions) — generate fresh files per sandbox (`containerization.md`).

### Storage at rest

pi stores provider creds in `~/.pi/agent/auth.json` at `0600` (or an OS keyring is
not offered by pi core — that's Codex's `cli_auth_credentials_store`, not pi).
**For Agenta:** the agent config carries secrets that get versioned as a workflow
revision, so they must be **encrypted at rest in Agenta's store**, not persisted in
plaintext alongside the rest of the config, and decrypted only at injection time.
pi gives no at-rest encryption beyond file perms, so this is Agenta's
responsibility. Prefer short-lived/scoped credentials where the provider supports
them (pi docs explicitly recommend this for sandboxed runs).

### How secrets reach the sandbox: env vs file vs API

Ranked by isolation:

1. **Gateway / inference routing (best):** raw provider key stays *outside* the
   sandbox; sandbox calls `inference.local`; gateway injects upstream
   (`containerization.md`). Use when we don't want the model key in the sandbox at
   all.
2. **Mounted auth file** (`auth.json` / `$CODEX_HOME/auth.json`): file perms
   `0600`, generated per run, removed on teardown. Can use `$ENV`/`!cmd`
   indirection so the file holds a reference, not the literal.
3. **Env vars (simplest, matches pi BYOK):** fine inside a per-run sandbox; avoid
   job-level env in any context that runs untrusted code (Codex doc warning).

In all cases the **sandbox is the scope**: one agent/session -> one sandbox -> one
minimal credential set, torn down after the run.

## Open questions

- **Per-session custom AuthStorage in pi SDK.** `setRuntimeApiKey` (non-persisted)
  and a "custom auth storage location" are documented in `sdk.md`, but the full
  API for a per-`session_id` in-memory credential store is not spelled out.
  Confirm against `@earendil-works/pi-agent-core` / `pi-coding-agent` types.
- **Does Agenta want pi-harness Codex (`openai-codex-responses`) or the real Codex
  CLI as the swappable harness?** They have different secret shapes and different
  instrumentation stories (pi events vs Codex `--json` stream). Decide before
  designing the "codex secret" type.
- **Daytona secret primitives.** This file covers pi + Codex. Whether Daytona has
  its own secret/env-injection API that the startup hook should use (vs writing
  files/env ourselves) is out of scope here — covered by the Daytona research
  topic in the README.
- **Codex `CODEX_HOME` isolation per run.** Confirm we give each Codex-harness run
  a clean `CODEX_HOME` to avoid the ChatGPT-vs-API-key conflict
  ([issue #3286](https://github.com/openai/codex/issues/3286)).
- **Third-party secret extensions.** `pi-secured-setup` / `pi-heimdall` /
  "Greywall" exist but are **UNVERIFIED** as to maintenance and fit; do not depend
  on them. If we want redaction, build it on the core `before_provider_*` hooks.
- **pi's `enableAnalytics` / `trackingId`.** Opt-in analytics exists
  (`PI_EXPERIMENTAL=1` setup). Confirm it is off in our sandbox image so nothing
  leaves the box unexpectedly.

## Sources

pi.dev (Earendil) — primary:

- pi.dev landing page — product overview, providers, modes: https://pi.dev
- providers.md (auth.json, provider env vars, /login, OAuth, ChatGPT Plus/Pro
  (Codex)): https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md
- custom-provider.md (registerProvider, apiKey/header syntax,
  `openai-codex-responses` API type, OAuthCredentials, authHeader):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md
- security.md (local trust boundary, no built-in sandbox, "minimum credentials"):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md
- containerization.md (Docker `-e` keys, Gondolin, OpenShell inference routing):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md
- settings.md (telemetry endpoints, PI_OFFLINE, analytics, sessionDir):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md
- usage.md (env vars, /login, --api-key):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md
- quickstart.md / index.md (subscription vs API-key first run):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md
- extensions.md (events: session_start, tool_call, before_provider_request):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- sdk.md (AuthStorage precedence, setRuntimeApiKey, custom auth storage):
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- packages/agent/docs/observability.md (safe/unsafe-by-default trace fields):
  https://github.com/earendil-works/pi/blob/main/packages/agent/docs/observability.md
- packages/agent/docs/hooks.md (before_provider_request/payload transform hooks):
  https://github.com/earendil-works/pi/blob/main/packages/agent/docs/hooks.md
- Cloudflare AI Gateway request (gateway is user-operated):
  https://github.com/earendil-works/pi/issues/3850
- pi-secret-guard package page (third-party, author acarerdinc):
  https://pi.dev/packages/pi-secret-guard

OpenAI Codex — primary:

- Codex authentication (ChatGPT vs API key, auth.json, CODEX_HOME,
  cli_auth_credentials_store, --with-api-key, --with-access-token):
  https://developers.openai.com/codex/auth
- Codex non-interactive (codex exec, CODEX_API_KEY, --ephemeral, --json, sandbox):
  https://developers.openai.com/codex/noninteractive
- Codex CLI reference (flags): https://developers.openai.com/codex/cli/reference
- Codex advanced config (model_providers, env_key):
  https://developers.openai.com/codex/config-advanced
- Codex enterprise access tokens:
  https://developers.openai.com/codex/enterprise/access-tokens
- Issue #5212 (OPENAI_API_KEY without writing auth.json — closed not planned):
  https://github.com/openai/codex/issues/5212
- Issue #3286 (env API-key sign-in blocked when ChatGPT login active):
  https://github.com/openai/codex/issues/3286

Secondary / corroborating (not load-bearing):

- simplified.guide Codex API-key login (codex login --with-api-key, login status):
  https://www.simplified.guide/codex/api-key-login
- Mario Zechner (pi author) build notes: https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
