# Other subscription providers

Research only, read on 2026-09-08. No code changed. The question: which other subscription
providers fit the hosted ChatGPT design in
[implementation-contract.md](../implementation-contract.md) with little change, which need more,
and which do not fit.

Everything below about Pi comes from the installed package, not from documentation:
`@earendil-works/pi-ai` version 0.80.6, at
`services/runner/node_modules/.pnpm/@earendil-works+pi-ai@0.80.6_*/node_modules/@earendil-works/pi-ai`.
Everything about Claude Code comes from the installed binary, version 2.1.263, at
`~/.local/share/claude/versions/2.1.263`. No token, no credential value, and no user code is
recorded here.

## What pi-ai 0.80.6 can log in to

`dist/utils/oauth/index.d.ts` exports exactly three OAuth providers, and no more:

| Pi provider id | Login flow | Headless | Source file |
| --- | --- | --- | --- |
| `openai-codex` | Device code, and a browser callback | Yes, `loginOpenAICodexDeviceCode` | `dist/utils/oauth/openai-codex.js` |
| `anthropic` | Authorization code with PKCE, local callback server on port 53692, plus a paste fallback | Partly, by paste only | `dist/utils/oauth/anthropic.js` |
| `github-copilot` | Device code | Yes, `loginGitHubCopilot` | `dist/utils/oauth/github-copilot.js` |

Pi has `google`, `google-vertex`, and `xai` model providers under `dist/providers/`, but they take
an API key. Pi has no OAuth login for Google or for xAI.

## Summary

| Provider | Headless login | Harness today | Effort | Verdict |
| --- | --- | --- | --- | --- |
| Claude, pasted `CLAUDE_CODE_OAUTH_TOKEN` | Not a login. The user pastes a token. | `claude` | 1 to 2 days | Ship first. Smallest change of all. |
| GitHub Copilot through Pi | Yes, device code | `pi_core` | 3 to 5 days | Fits the design almost unchanged. |
| Claude through the `claude` harness, hosted login | Yes, by paste of a code | `claude` | 6 to 9 days | Fits, but the login is a paste, not a device code, and the file format differs. |
| Claude through Pi | Yes, by paste of a code | `pi_core` | 3 to 5 days | Works technically. Pi sends Claude Code's client identity on the wire; see 1b. |
| Google Gemini subscription | No | None | 15 days or more | Does not fit. Google has no device flow. |
| Grok, SuperGrok | Yes, `grok login --device-auth` | None. Needs a new harness. | 10 to 18 days | Does not fit yet. New harness plus an undocumented login contract. |

## 1. Claude subscription

### 1a. Pi has no device login for Anthropic

`loginAnthropic` in `dist/utils/oauth/anthropic.js` starts an HTTP server on `127.0.0.1:53692` and
sends the user to `https://claude.ai/oauth/authorize` with
`redirect_uri=http://localhost:53692/callback`. There is no device code. The login resolves in one
of two ways:

1. The user's browser reaches the callback server. This works only when the browser runs on the
   same machine as the runner. In a hosted product it never does.
2. The caller passes `onManualCodeInput` or `onPrompt`, and the user pastes the authorization code
   or the whole redirect URL. `parseAuthorizationInput` accepts a full URL, a `code#state` pair, or
   a bare code.

So a hosted Claude login is possible headless, but the shape is a paste, not a device code. The
browser and the API routes in section 2 of the contract assume a user code plus a verification
address plus polling. A paste needs one more route, `POST .../login-attempts/{id}/code`, and a
different card in the browser.

The credential Pi stores is smaller than the ChatGPT one:

```json
{"type": "oauth", "refresh": "...", "access": "...", "expires": 1789000000000}
```

There is no `accountId`, and the access token is not a JWT. Measured on the local Claude Code
credential file: the access and refresh tokens are 108 character opaque strings.

### 1b. Pi presents itself as Claude Code when it uses an Anthropic OAuth token

This is the finding that decides the question. In `dist/api/anthropic-messages.js`, when the
credential is an OAuth token, Pi sends:

- `user-agent: claude-cli/<version>` and `x-app: cli` (line 648 and 649).
- `anthropic-beta: claude-code-20250219,oauth-2025-04-20`.
- A forced first system block, `"You are Claude Code, Anthropic's official CLI for Claude."`
  (line 685).
- Claude Code's tool names. The file calls this "Stealth mode: Mimic Claude Code's tool naming
  exactly" (line 35).

Pi's Anthropic client id is `9d1c250a-e61b-44d9-88ed-5944d1962f5e`. The same value is Claude Code's
own `CLIENT_ID` in the 2.1.263 binary. Pi's scope string is Claude Code's own scope set.

Pi is therefore not a client that Anthropic authorized. It presents itself as Claude Code. Compare
the ChatGPT path, where Pi sets `originator=pi` on the authorization URL
(`dist/utils/oauth/openai-codex.js` line 241) and `originator: pi` on every request
(`dist/api/openai-codex-responses.js` line 1196).

### 1c. What the `claude` harness does today

`services/runner/src/subscription-status.ts` probes `CLAUDE_CONFIG_DIR/.credentials.json` for the
`claude` harness. `services/runner/src/engines/sandbox_agent/environment-setup.ts` line 347 states
that a local Claude subscription run reads and writes the operator mount directly, with no per-run
copy, because Claude Code refreshes its token mid run and writes it back. `run-plan.ts` line 619
rejects a `runtime_provided` Claude run when `CLAUDE_CONFIG_DIR` is unset.

The real file on this box has this shape:

```json
{"claudeAiOauth": {"accessToken": "...", "refreshToken": "...", "expiresAt": 0,
  "refreshTokenExpiresAt": 0, "scopes": [], "subscriptionType": "...", "rateLimitTier": "..."},
 "mcpOAuth": {}}
```

### 1d. A Pi credential converts into `.credentials.json`

Yes, and the missing fields are optional. Read out of the 2.1.263 binary:

- The credential normalizer writes
  `subscriptionType: t.subscriptionType ?? e?.subscriptionType ?? null` and the same pattern for
  `rateLimitTier`. Both accept null.
- The refresh call builds `client_id: o ?? CLIENT_ID` and
  `scope: (Array.isArray(t) && t.length ? t : V3).join(" ")`, where `V3` is Claude Code's own scope
  list. So a stored credential without `clientId` and without `scopes` refreshes against Claude
  Code's defaults.

The conversion is therefore:

| Claude Code field | Pi field | Note |
| --- | --- | --- |
| `claudeAiOauth.accessToken` | `access` | Direct. |
| `claudeAiOauth.refreshToken` | `refresh` | Direct. |
| `claudeAiOauth.expiresAt` | `expires` | Both are epoch milliseconds. |
| `claudeAiOauth.refreshTokenExpiresAt` | none | Omit. |
| `claudeAiOauth.scopes` | none | Omit. Claude Code falls back to its own set. |
| `claudeAiOauth.subscriptionType` | none | Omit. Normalizes to null. |
| `claudeAiOauth.rateLimitTier` | none | Omit. Normalizes to null. |
| `claudeAiOauth.clientId` | none | Omit. Claude Code falls back to its own client id. |

Confidence is high on the format and it still needs one live test, because a startup path could
read a field the refresh path does not.

The reverse direction also works, and it is the one the push back needs: read
`.credentials.json` after a turn and store `{access, refresh, expires}`.

### 1e. The simplest Claude path: a pasted long lived token

The 2.1.263 binary carries a `setup-token` command and a `CLAUDE_CODE_OAUTH_TOKEN` environment
variable. Its own strings say `setup-token creates a long-lived Claude.ai subscription token` and
`setup-token sessions default to user:inference only`. The user runs `claude setup-token` on their
own machine and pastes the result into Agenta.

This needs no login attempt, no device code, no refresh, and no push back. It is an ordinary
write only secret plus one environment variable on the Claude daemon. It costs the in product
login experience and it depends on the user running a CLI command once. An operator managed policy
can forbid `setup-token`, and a token has a fixed lifetime, so the connection needs an expiry
warning.

### 1f. Claude table

| Field | 1a. Pi | 1c to 1d. `claude` harness, hosted login | 1e. Pasted token |
| --- | --- | --- | --- |
| Headless login | By paste of a code or redirect URL. No device code. | Same. The code comes from Claude's own authorize page. | Not a login. A paste of a token. |
| Credential fields | `type`, `access`, `refresh`, `expires` | Same, converted into `claudeAiOauth` | One opaque token |
| Refresh owner | Pi, under its `auth.json` lock | Claude Code, under its own lock, in `.credentials.json` | None. The token is long lived. |
| Refresh trigger | Expiry, during a turn | Expiry, during a turn | None |
| Harness today | `pi_core` | `claude` | `claude` |
| Model list source | Pi's `anthropic` catalog | `CLAUDE_MODEL_ALIASES` in `sdks/python/agenta/sdk/agents/capabilities.py`. Already correct. | Same |
| Provider value | `claude` | `claude` | `claude` |
| Provider id per harness | `pi_core` to `anthropic` | `claude` to `anthropic` | `claude` to `anthropic` |
| Token validation | The JWT account claim check fails. Needs a per provider validator. | Same | Shape only |
| Effort | 3 to 5 days | 6 to 9 days | 1 to 2 days |
| Verdict | Works; presents as Claude Code on the wire | Recommended for the full experience | Recommended first |

Extra work specific to 1c and 1d, beyond the ChatGPT slice:

- A per connection `CLAUDE_CONFIG_DIR`, the way `pi-assets.ts` builds a per connection Pi agent
  directory. Today the Claude branch has none by design.
- The push back reads `.credentials.json`, not `auth.json`, and Claude Code owns the lock. The
  runner's `proper-lockfile` on Pi's `auth.json` does not apply. The concurrent loser story needs
  its own measurement.
- Claude Code writes other files into its config directory. Only `.credentials.json` may be
  carried back.
- The `claude` harness already declares the `anthropic` family and the `self_managed` mode in
  `capabilities.py`, so no new capability row is needed.

## 2. GitHub Copilot through Pi

This is the closest fit to the shipped design. `loginGitHubCopilot` is a real device code flow
against `https://github.com/login/device/code`, with `pollOAuthDeviceCodeFlow` doing the polling,
an `AbortSignal` for cancel, and an `onDeviceCode` callback carrying `userCode`,
`verificationUri`, `intervalSeconds`, and `expiresInSeconds`. That is the same callback shape the
runner already consumes for ChatGPT.

One difference in the call: `loginGitHubCopilot` calls `onPrompt` FIRST, to ask for a GitHub
Enterprise domain, with `allowEmpty: true`. A headless caller must pass an `onPrompt` that resolves
an empty string at once. That is three lines.

Stored credential:

```json
{"type": "oauth", "refresh": "<github token>", "access": "<copilot token>",
 "expires": 1789000000000, "enterpriseUrl": null, "availableModelIds": ["..."]}
```

`refresh` is the GitHub OAuth access token and it never rotates. `access` is a short lived Copilot
token minted from it at `https://api.github.com/copilot_internal/v2/token`, and the code sets
`expires` to `expires_at * 1000` minus five minutes. Login also enables every known model on the
account, then reads back the selectable ones.

The model list comes free: `availableModelIds` sits inside the credential, and
`refreshGitHubCopilotToken` refreshes it on every refresh. The vendored catalog in
`dist/providers/github-copilot.models.js` holds 25 models, across `claude-*`, `gemini-*`, `gpt-*`,
`kimi-k2.7-code`, and `mai-code-1-flash-picker`. One login, many models, which is the strongest
product argument for this provider.

| Field | Value |
| --- | --- |
| Headless login | Yes. Device code, same callback shape as ChatGPT. |
| Credential fields | `type`, `access`, `refresh`, `expires`, `enterpriseUrl`, `availableModelIds` |
| Refresh owner | Pi, under the same `auth.json` lock |
| Refresh trigger | Expiry. The Copilot token lives about 30 minutes, so a refresh happens on nearly every session. |
| Harness today | `pi_core` |
| Model list source | `availableModelIds` in the credential, per account |
| Provider value | `github_copilot` |
| Provider id per harness | `pi_core` to `github-copilot` |
| Token validation | The JWT account claim check fails. The Copilot token is a semicolon separated string such as `tid=...;exp=...;proxy-ep=...`, which Pi already parses in `getBaseUrlFromToken`. |
| Effort | 3 to 5 days |

Contract changes:

- `SubscriptionProviderKind` gains `GITHUB_COPILOT`, with its own display name and harness list.
- The push rules in `_classify_push` need a change. Today a pushed login whose `refresh` equals the
  stored one is a NOOP. For Copilot the refresh token NEVER changes, so every push would be a
  NOOP and the fresh access token would never reach the vault. This is acceptable and it should be
  a decision, not an accident: the durable credential is the GitHub token, and Pi mints a new
  access token at session start anyway. Either accept the NOOP and skip the push back for this
  provider, or compare `access` and `expires` instead of `refresh`.
- `_login_is_usable` rejects a login whose `expires` is in the past. A stored Copilot login goes
  stale in 30 minutes, so this rule must not run on the delivery path, only on the push path.
- `PI_VAULT_PROVIDERS` and the capability table gain a `github-copilot` family, plus a model list.
- A stored `enterpriseUrl` means the browser needs an optional enterprise domain field. Leave it
  out of the first version and support `github.com` only.

Note: Pi sends VS Code identity headers
(`Editor-Version: vscode/1.107.0`, `Copilot-Integration-Id: vscode-chat`). This is the same class
of problem as section 1b, though it is weaker: the headers name an integration id rather than
forcing a system prompt. Ask the same question that section 1b answers for Anthropic.

## 3. Google Gemini subscription

Does not fit. There is no headless login.

- pi-ai 0.80.6 has no Google OAuth provider. Its `google` and `google-vertex` providers take an API
  key.
- Gemini CLI signs in with a browser loopback flow. The official page states the method is for
  Google AI Pro and Google AI Ultra subscribers, and that credentials cache locally, without a
  device code option
  (https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html, read
  2026-09-08).
- For headless use the same page directs the user to an API key, `GEMINI_API_KEY`, or to
  Application Default Credentials with a service account. Neither uses the subscription.
- Device code support is an open request upstream. Issue 1696 asks for it and is closed as a
  duplicate of 1439 (https://github.com/google-gemini/gemini-cli/issues/1696).

An API key path already exists in Agenta as a normal `provider_key` secret, so there is nothing to
add. Revisit only when Google ships a device flow. Effort if that happens: about the same as
Copilot, plus a new harness if the plan is to drive Gemini CLI rather than Pi.

## 4. Grok, SuperGrok through the Grok CLI

Does not fit yet. The login is headless, but nothing else is in place.

Confirmed from the current public docs, read 2026-09-08:

- `grok login` takes a `--device-auth` flag for headless and remote environments. `grok logout`
  clears cached credentials. `grok agent stdio` runs the CLI as an ACP agent over standard input
  and output (https://docs.x.ai/build/cli/reference).
- Headless sessions live in `~/.grok/sessions`, and the config file is `~/.grok/config.toml`. The
  page assumes the CLI is already authenticated locally or that `XAI_API_KEY` is set
  (https://docs.x.ai/build/cli/headless-scripting).
- The public pages still do not document a credential file schema, a `GROK_HOME` variable, a
  refresh rule, or any machine readable output for the login itself. The v0 note in
  [../v0/research.md](../v0/research.md) said the same thing on 2026-09-07, and nothing has
  changed.

pi-ai has no xAI OAuth, so Pi cannot carry this credential. The design would need a whole new
harness.

| Field | Value |
| --- | --- |
| Headless login | Yes, `grok login --device-auth`, but only as terminal text. No documented machine readable form. |
| Credential fields | Not documented. The v0 note names `auth.json` under `GROK_HOME`. Must be measured. |
| Refresh owner | The Grok CLI, silently, per the enterprise page. |
| Refresh trigger | Expiry, during use. Unmeasured. |
| Harness today | None |
| Model list source | None in Agenta. Would come from the CLI or from a pinned list. |
| Provider value | `grok` |
| Provider id per harness | A new `grok` harness to an `xai` family |
| Token validation | Nothing to check. No JWT, no account claim. |
| Effort | 10 to 18 days |

The work, itemized:

| Item | Days |
| --- | --- |
| New harness kind through `harness-kind.ts`, `HarnessKind` in `sdks/python/agenta/sdk/agents/dtos.py`, the capability table, and the web picker | 3 to 5 |
| Runner assets module and daemon spawn for `grok agent stdio`, in the style of `codex-assets.ts` | 3 to 5 |
| Login parser for `grok login --device-auth` terminal output, pinned to one CLI version, with an end to end test before every upgrade | 2 to 3 |
| Status probe, credential materialize, push back, error classification | 2 to 3 |
| Sandbox policy check that a tool cannot read the authentication home while the parent process still refreshes it | 1 to 2 |

Do not start this until xAI answers one of the three asks in the v0 note: a structured login
command, a registered OAuth client with RFC 8628 endpoints, or a versioned terminal output
contract. Parsing unversioned terminal text for a paid product is a standing liability.

## 5. What is ChatGPT specific in the current contract

Four places assume ChatGPT. Every provider above trips at least one.

1. **The account claim.** `_jwt_account_id` in `api/oss/src/core/secrets/subscription_service.py`
   decodes the access token as a JWT and reads
   `https://api.openai.com/auth` then `chatgpt_account_id`. `_login_is_usable` refuses a login with
   no such claim. `validateSubscriptionLogin` in
   `services/runner/src/engines/sandbox_agent/subscription-login.ts` applies the same rule. Neither
   Anthropic nor Copilot issues a JWT here, so both need a per provider validator. Keep the two
   implementations in agreement, as the comment already demands.
2. **The account identity rule.** `_classify_push` rejects a push when
   `login.accountId != stored.login.accountId`. Anthropic and Copilot carry no `accountId`, so the
   comparison is null against null and the rule stops protecting anything. Each provider needs its
   own identity field, or the rule must state that it does not apply.
3. **The refresh token as the idempotency key.** A push whose `refresh` equals the stored one is a
   NOOP. Correct for ChatGPT and for Anthropic. Wrong for Copilot, whose refresh token never
   rotates. See section 2.
4. **The model list.** `SUBSCRIPTION_PROVIDER_MODELS` in `api/oss/src/core/secrets/enums.py` holds
   a hand copied ChatGPT list. Copilot carries its list inside the credential, per account. Claude
   already has `CLAUDE_MODEL_ALIASES`. The field needs to become per provider, and for Copilot it
   needs to be writable from a login result.

Two more, smaller:

- `SUBSCRIPTION_PROVIDER_HARNESSES` maps a provider to `["pi_core"]`. Claude maps to `["claude"]`.
- `_SUBSCRIPTION_HARNESS_PROVIDERS` in `sdks/python/agenta/sdk/agents/platform/connections.py`
  currently maps `pi_core` to `openai-codex` and `codex` to `openai`. It must become a map keyed by
  the pair, provider and harness, not by harness alone.

The login attempt routes in section 2 of the contract survive unchanged for any device code
provider. They do not survive a paste flow, which needs one added route to submit the code.

## Recommendation order

1. **Claude with a pasted `CLAUDE_CODE_OAUTH_TOKEN`, 1 to 2 days.** It reuses the existing `claude`
   harness, the existing model list, and an ordinary write only secret. It ships a second provider
   in a week and it proves the picker and the error path for a non ChatGPT provider. Its weakness
   is the user experience: the user runs a CLI command once.
2. **GitHub Copilot through Pi, 3 to 5 days.** The only other real device code flow available. It
   gives 25 models from one login, and it forces the four generalizations in section 5, which every
   later provider needs. 
3. **Claude through the `claude` harness with a hosted login, 6 to 9 days.** The best experience,
   and the one users will ask for. It needs a paste based attempt flow, a per connection config
   directory, and a fresh look at the concurrent refresh loser, because Claude Code owns that lock,
   not the runner.
4. **Grok, 10 to 18 days, blocked.** Wait for a supported login contract from xAI.
5. **Gemini, blocked upstream.** Nothing to build until Google ships a device flow.

Do not build Claude through Pi. Section 1b is the reason.

## Open questions for Mahmoud


## Survey: subscription logins across coding agents

Research only, read on 2026-09-08. No code changed. The earlier pass looked only at the OAuth
exports of the installed pi-ai. This pass reads the whole `/login` code path in the installed
package, the current upstream Pi repository, the Hermes Agent source, and fourteen other coding
agents. The goal is one list of every subscription login that a coding agent can sign in with, so
Agenta can choose which subscriptions to host. No token value and no credential value is recorded
here.

### Method and sources

| Source | What was read |
| --- | --- |
| Installed Pi 0.80.6 | `services/runner/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.6_*/node_modules/@earendil-works/pi-coding-agent` and the matching `pi-ai` package, `dist` with source maps, and the bundled `docs/`. |
| Pi upstream | [github.com/earendil-works/pi](https://github.com/earendil-works/pi) at commit `6160683a4a`, dated 2026-09-08. |
| Hermes Agent | [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) at commit `c8aa5608c2`, dated 2026-09-08, version 0.21.1. |
| Fourteen other agents | Source files on `raw.githubusercontent.com` and vendor documentation. Each claim below carries its URL. |

### 6. What Pi's `/login` really offers

The earlier pass was correct about OAuth, and incomplete about `/login`. The `/login` command is a
two step selector, and only the first branch is a subscription.

`showLoginAuthTypeSelector` in
`dist/modes/interactive/interactive-mode.js` line 4044 offers two options, "Use a subscription" and
"Use an API key". `getLoginProviderOptions` at line 3967 builds each branch differently:

- The subscription branch is `authStorage.getOAuthProviders()`. In 0.80.6 that is exactly three
  entries: `anthropic`, `github-copilot`, `openai-codex`.
- The API key branch is every model provider in the registry that passes `isApiKeyLoginProvider`
  at line 130. That is 37 providers, and it includes OpenRouter, Z.AI, Kimi For Coding, MiniMax,
  Cerebras, Groq, Mistral, Vercel AI Gateway, and OpenCode Zen.

`formatAuthSelectorProviderType` in `dist/modes/interactive/components/oauth-selector.js` line 4
prints the label: `authType === "oauth"` shows `[subscription]`, everything else shows `[API key]`.
So an entry such as OpenRouter is in the `/login` list, but it is an API key that the user types in,
not a subscription that Pi logs in to.

The full API key list in 0.80.6, read from `dist/providers/`, is: Anthropic, Ant Ling, AWS
credentials, Azure OpenAI, Cerebras, Cloudflare AI Gateway, Cloudflare Workers AI, DeepSeek,
Fireworks, GitHub Copilot, Google, Google Cloud credentials, Groq, Hugging Face, Kimi For Coding,
MiniMax, MiniMax CN, Mistral, Moonshot AI, Moonshot AI CN, NVIDIA, OpenAI, OpenAI Codex, OpenCode
Zen, OpenCode Zen Go, OpenRouter, Together, Vercel AI Gateway, xAI, Xiaomi, three Xiaomi Token Plan
regions, Z.AI, and Z.AI Coding CN.

The bundled `docs/providers.md` agrees. Its "Subscriptions" section lists three items, ChatGPT
Plus/Pro (Codex), Claude Pro/Max, and GitHub Copilot, and its "API Keys" section lists the rest.

### 6a. "cai" is not a provider

There is no provider with the id `cai` in Pi 0.80.6, in Pi upstream, in Hermes Agent, in OpenCode,
or in the models.dev catalog that OpenCode, Cline, and Kilo Code all read. A search of the Pi
repository for `cai` returns only base64 fragments inside lock file integrity hashes and one
contributor handle.

The entry Mahmoud saw is a fuzzy filter artifact. `filterProviders` in `oauth-selector.js` line 68
matches the query against `` `${provider.name} ${provider.id} ${provider.authType}` ``, and
`fuzzyFilter` in the Pi TUI package is a subsequence match. The letters c, a, and i in that order
match 17 of the 36 rows. The top two hits are **Vercel AI Gateway** and **Cloudflare AI Gateway**.
Many of the other hits match only because the literal string `api_key` supplies the a and the i.
Nothing is hidden. Typing `cai` selects a real provider from that list, and never a provider called
`cai`.

### 6b. Pi upstream 0.85.1 adds four more subscription logins

Pi is now at 0.85.1, published 2026-09-05, for both `@earendil-works/pi-coding-agent` and
`@earendil-works/pi-ai`. The runner is 14 releases behind. The OAuth code moved from
`packages/ai/src/utils/oauth/` to
[`packages/ai/src/auth/oauth/`](https://github.com/earendil-works/pi/tree/6160683a4a8012f0d1cd30c145df18b4ca6f5176/packages/ai/src/auth/oauth),
and each provider now owns its login through an `auth.oauth` field.

| Pi OAuth provider | Added in | Flow | Subscription |
| --- | --- | --- | --- |
| `anthropic` | before 0.80.6 | PKCE, local callback, paste fallback | Yes, Claude Pro/Max |
| `openai-codex` | before 0.80.6 | Device code, and a browser callback | Yes, ChatGPT Plus/Pro |
| `github-copilot` | before 0.80.6 | Device code | Yes, a Copilot seat |
| `xai` | 0.80.8 | Device code, labelled "Sign in with SuperGrok or X Premium" | Yes, `isSubscription: true` |
| `openrouter` | 0.82.0 | OAuth PKCE that mints an API key | No, prepaid credits |
| `kimi-coding` | 0.82.0 | Device authorization | Yes, `isSubscription: true` |
| `radius` | 0.80.8 | Device authorization against a configured gateway | No, a gateway |

Three upstream changes matter to the design:

1. **`registerOAuthProvider()` is gone.** 0.80.8 removed the registry and stopped exporting
   `AuthStorage`. A custom OAuth provider is now registered through
   `pi.registerProvider(id, { oauth: { name, login, refreshToken, getApiKey, isSubscription } })`,
   documented in
   [`packages/coding-agent/docs/custom-provider.md`](https://github.com/earendil-works/pi/blob/6160683a4a8012f0d1cd30c145df18b4ca6f5176/packages/coding-agent/docs/custom-provider.md).
   `refreshToken` must accept and honour an `AbortSignal` since 0.84.0. This is the extension point
   Agenta would use to add a provider Pi does not ship.
2. **0.83.0 added `pi auth print-api-key` and `pi auth print-bearer-token`.** Both export the
   resolved credential and refresh it first. That is a clean way for the runner to hand a live
   token to another process.
3. **0.83.0 made OpenRouter login headless** by accepting a pasted redirect URL or auth code.

### 6c. Pi bills Claude subscription use as extra usage

`docs/providers.md` in the installed 0.80.6 package states it plainly: "Third-party harness usage
draws from extra usage and is billed per token, not against Claude plan limits." A user who
connects Claude through Pi therefore pays per token on top of the plan. That is a product fact for
the connect card.
run Claude through Pi.

### 7. Hermes Agent by Nous Research

Hermes Agent is the most complete subscription login surface of any agent in this survey. It is
public, MIT licensed, Python, and at version 0.21.1. The registries are `PROVIDER_REGISTRY` and
`OAUTH_PROVIDER_FLOWS` in
[`hermes_cli/auth.py`](https://github.com/NousResearch/hermes-agent/blob/c8aa5608c24e3636e77c267650c0f1f52e44adb0/hermes_cli/auth.py),
and `_OAUTH_CAPABLE_PROVIDERS` in
[`hermes_cli/auth_commands.py`](https://github.com/NousResearch/hermes-agent/blob/c8aa5608c24e3636e77c267650c0f1f52e44adb0/hermes_cli/auth_commands.py).

| Hermes provider | Flow | Stored at | Refresh | Subscription |
| --- | --- | --- | --- | --- |
| `anthropic` | PKCE, paste the code, no local server | `~/.hermes/.anthropic_oauth.json` | Yes, rotating | Yes, Claude Pro/Max |
| `openai-codex` | Device code at `auth.openai.com` | `~/.hermes/auth.json` | Yes, rotating | Yes, ChatGPT Plus/Pro |
| `nous` | Device code at the Nous Portal | `~/.hermes/auth.json` | Yes | Yes, 20 to 200 dollars per month |
| `xai-oauth` | Device code, OIDC discovery at `auth.x.ai` | `~/.hermes/auth.json` | Yes, rotating | Yes, SuperGrok or X Premium+ |
| `minimax-oauth` | User code plus PKCE | `~/.hermes/auth.json` | Yes | A portal account, not a paid tier |
| `qwen-oauth` | No login of its own. It reads and refreshes the Qwen Code CLI file. | `~/.qwen/oauth_creds.json` | Yes, writes back | A Qwen portal account |
| `copilot` | GitHub device flow | An environment variable or `gh auth token` | The Copilot JWT exchange | Yes, a Copilot seat |

Every model provider login in Hermes is headless. None uses a local callback. Hermes documents this
in
[`website/docs/guides/oauth-over-ssh.md`](https://github.com/NousResearch/hermes-agent/blob/c8aa5608c24e3636e77c267650c0f1f52e44adb0/website/docs/guides/oauth-over-ssh.md),
and `_is_remote_session()` in `hermes_cli/auth_device_flow.py` suppresses the browser when it sees
an SSH or cloud IDE environment. The only loopback flows are Spotify and remote MCP servers.

Hermes refuses several providers that people assume it has. OpenRouter, Google Gemini, Z.ai, Kimi,
plain MiniMax, and Vercel are API key only. Cerebras and Groq are absent from the repository.

Two Hermes details are worth copying and one is worth avoiding:

- Copy the paste flow. `run_hermes_oauth_login_pure` in `agent/anthropic_credentials.py` line 512
  is a complete, headless Claude Pro/Max login that needs no local server.
- Copy the quarantine. An `invalid_grant` result quarantines the credential and asks the user to
  sign in again, rather than retrying forever.
- Avoid a concurrent refresh. `REFRESHABLE_OAUTH_PROVIDERS` in `agent/credential_pool.py` line 890
  covers `anthropic`, `nous`, `openai-codex`, and `xai-oauth`, and the Nous refresh token is single
  use. Two workers that refresh at the same time revoke the user's session.

### 8. Every other coding agent, one line each

| Agent | Source | Subscription logins | Headless or device flow |
| --- | --- | --- | --- |
| OpenCode | `sst/opencode`, now [anomalyco/opencode](https://github.com/anomalyco/opencode), branch `dev` | ChatGPT Plus/Pro, GitHub Copilot, GitLab Duo, Poe, DigitalOcean, Azure Entra ID, Snowflake, xAI SuperGrok, OpenCode Console. Claude Pro/Max was removed in 1.3.0. | Yes, four device flows |
| Crush | [charmbracelet/crush](https://github.com/charmbracelet/crush) | Charm Hyper, GitHub Copilot | Yes, both device flows |
| Cline | [cline/cline](https://github.com/cline/cline) | A Cline account through WorkOS, ChatGPT Codex, plus pass through to the `claude-code`, `codex`, and `opencode` CLIs | Yes for the Cline account. ChatGPT is `localhost:1455` only. |
| Kilo Code | [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode), now an OpenCode fork | ChatGPT, GitHub Copilot, xAI, a Kilo Gateway account, DigitalOcean, Snowflake, Cloudflare, GitLab, Poe | Yes, four device flows, labelled headless |
| Roo Code | [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code), archived 2026-05-15 | ChatGPT PKCE, Qwen Code credential import, OpenRouter | No, every flow needs a browser callback |
| Continue | [continuedev/continue](https://github.com/continuedev/continue) | None. The hub login is a stub that throws. | Not applicable |
| Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) | OpenRouter PKCE only, which yields an API key | No, it binds ports 8484 to 8584 |
| Goose | [block/goose](https://github.com/block/goose) | GitHub Copilot, Kimi for Coding, ChatGPT, Gemini Code Assist, plus pass through to other CLIs | Yes for Copilot and Kimi. No for ChatGPT and Gemini. |
| Amp | Sourcegraph, `@ampcode/cli` | An Amp account. The web account can link ChatGPT and Grok. No Claude Pro/Max. | No. Headless means pasting an `AMP_API_KEY`. |
| Factory Droid | `@factory/cli` | A Factory account through WorkOS | Yes, RFC 8628 device code |
| Cursor CLI | `cursor-agent` | The Cursor Pro or Business subscription | Yes in effect. It prints a URL and long polls, with no local callback. |
| Gemini CLI | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | A Google account through Gemini Code Assist | Partly. `NO_BROWSER=true` gives a paste flow, but it needs a TTY. |
| Codex CLI | [openai/codex](https://github.com/openai/codex) | ChatGPT Plus, Pro, and Business | Yes, `codex login --device-auth`, plus `--with-access-token` on stdin |
| Claude Code | Anthropic, closed source | Claude Pro, Max, Team, Enterprise | Partly. The browser flow has a paste fallback, and `claude setup-token` mints a one year token. |
| Grok CLI | `xai-org/grok-build` | SuperGrok and X Premium+ | Yes, `grok login --device-auth`, and it is documented |

Three of these show a flow Agenta could reuse, so they get more detail.

**OpenCode, the ChatGPT device flow.** The file is
[`packages/opencode/src/plugin/openai/codex.ts`](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/plugin/openai/codex.ts),
and the method is labelled "ChatGPT Pro/Plus (headless)". It posts to
`https://auth.openai.com/api/accounts/deviceauth/usercode` with the public client id
`app_EMoamEEZ73f0CkXaXp7hrann`, sends the user to `https://auth.openai.com/codex/device`, polls
`/api/accounts/deviceauth/token`, and treats 403 and 404 as "keep polling". It then exchanges the
authorization code at `/oauth/token`. These are the same endpoints and the same client id that Pi
0.80.6 uses in `dist/utils/oauth/openai-codex.js` lines 22 to 30, that Codex CLI uses, and that
Hermes uses. Agenta already implements this flow.

The important part for us is storage.
[`packages/opencode/src/auth/index.ts`](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/auth/index.ts)
reads the whole credential file from the environment variable `OPENCODE_AUTH_CONTENT`. Kilo Code
has the same escape hatch as `KILO_AUTH_CONTENT`. That is exactly the injection shape the shipped
Agenta design needs, and it removes the need to write a file into the sandbox.

**GitHub Copilot, the device flow that four agents share.** The flow is GitHub's own documented
device flow. The second step is not documented: the GitHub token must be exchanged at
`https://api.github.com/copilot_internal/v2/token` for a Copilot JWT that lives about 30 minutes.
Pi 0.80.6 hides its client id from secret scanners by base64 encoding it in
`dist/utils/oauth/github-copilot.js` line 7. Decoded, it is `Iv1.b507a08c87ecfe98`, which is the
Visual Studio Code Copilot application id. Crush and Goose use the same value. OpenCode and Kilo
Code use `Ov23li8tweQw6odWQebz`. A caller that registers its own GitHub application gets a 404 from
the exchange endpoint, so there is no compliant client id to use. The durable credential is the
GitHub token, which never rotates.

**Claude, the two headless paths.** The browser flow has a documented paste fallback for exactly
our case: "This happens when the browser can't reach Claude Code's local callback server, which is
common in WSL2, SSH sessions, and containers"
([code.claude.com/docs/en/authentication](https://code.claude.com/docs/en/authentication)). Separately,
`claude setup-token` mints a one year token that the user exports as `CLAUDE_CODE_OAUTH_TOKEN`, and
that token can only make model requests. This confirms section 1e.

### 9. The provider side

This table answers one question per provider: can a user connect a plan they already pay for, and
may they.

| Provider | Paid plan behind the login | Headless login | Credential |
| --- | --- | --- | --- |
| OpenAI ChatGPT Codex | Plus, Pro, Business | Yes, device code, but the account or the workspace admin must enable it | Access, refresh, and id tokens |
| Anthropic Claude | Pro, Max, Team | Paste a code, or a one year `setup-token` | Access and refresh, opaque |
| GitHub Copilot | Pro, Pro+, Max, Business, Enterprise | Yes, GitHub device flow | A GitHub token, exchanged for a 30 minute JWT |
| Google Gemini | AI Pro, Ultra, Code Assist | No. Loopback only. Headless means an API key. | OAuth tokens |
| xAI SuperGrok | SuperGrok, X Premium+ | Yes, device code at `auth.x.ai` | Access and refresh |
| Kimi, Moonshot | Kimi membership | Yes, RFC 8628, documented and MIT licensed | Access and refresh |
| MiniMax | A token plan | Yes, RFC 8628 with PKCE | Access and refresh |
| Z.ai GLM | Lite, Pro, Max | An undocumented poll flow only | Opaque, no refresh |
| Qwen | Coding Plan | OAuth was discontinued on 2026-04-15 | An `sk-sp-` API key |
| Mistral | Pro, Team | A poll flow with no local callback | A plain API key |
| Cursor | Pro, Business | Yes, but the flow is reverse engineered | Access and refresh JWT |
| Windsurf | Pro, Max | Yes, a paste flow | An opaque session key, no refresh |
| Amazon Kiro, Q Developer | Kiro Pro to Power | Yes, first party AWS OIDC device code | Access and refresh |
| Nous Portal | 20, 100, 200 dollars per month | Yes, RFC 8628 | JWT with a single use rotating refresh |
| OpenRouter | **No.** Prepaid credits. | Yes, a documented no callback mode | An API key |
| Vercel v0, AI Gateway | v0 per user, Gateway credits | A device flow for the account, not the model | `vck_` and similar |
| Cerebras Code | Pro, Max | No OAuth at all | An API key |
| Groq | No subscription | No OAuth at all | An API key |
| Poe | 4.99 to 249.99 dollars per month | No device flow, but a documented hosted HTTPS callback | An API key with an optional expiry, no refresh |
| GitLab Duo | Pro, Enterprise, per seat | Yes, RFC 8628, generally available since 17.9 | Access and refresh |

Three findings from this table change the plan.

**Poe is the only subscription in the table whose vendor documents the hosted pattern.** "Sign in
with Poe" is a first party PKCE flow with a hosted HTTPS redirect as the production path, scope
`apikey:create`, and Poe publishes the client library. The credential is an API key with no refresh
token. The risk is spend: the key exposes the whole point balance, so Agenta owns the guard.

**A green login does not prove a working connection.** xAI has been seen to return 403 to standard
SuperGrok subscribers on its OAuth API surface, and Copilot returns 404 from the token exchange
unless the caller presents the legacy editor client id. Any connect card must test one real request
before it says "connected".

### 10. Fit with the shipped design

"Reuse" means the login attempt routes in section 2 of
[implementation-contract.md](../implementation-contract.md) work unchanged. "Small change" means one
added route or one generalized field, from the four listed in section 5 above. Effort is one
engineer, including QA on a live stack.

| Provider | Paid plan | Headless login | Harness | Fit | Days |
| --- | --- | --- | --- | --- | --- |
| GitHub Copilot | Yes | Yes, device code | `pi_core`, already installed | Reuse. It forces the four generalizations in section 5. | 3 to 5 |
| Claude, pasted `CLAUDE_CODE_OAUTH_TOKEN` | Yes | Not a login. The user pastes. | `claude` | Small change. A write only secret. | 1 to 2 |
| xAI SuperGrok | Yes | Yes, device code | `pi_core`, needs 0.85.1 | Small change, plus a Pi upgrade. | 4 to 6, plus the upgrade |
| Kimi for Coding | Yes | Yes, device code | `pi_core`, needs 0.85.1 | Small change, plus a Pi upgrade. | Not now |
| OpenRouter | No, credits | Yes | `pi_core`, needs 0.85.1 | Reuse. It is prepaid credits, not a subscription. | 2 to 3 |
| Claude through the stock binary | Yes | Paste a code | `claude` | New harness work. Agenta must not hold the token. | 6 to 9 |
| Poe | Yes | A hosted callback, not device code | New. Poe is OpenAI compatible. | New harness, sanctioned by the vendor. | 8 to 12 |
| Amazon Kiro | Yes | Yes, AWS OIDC device code | New | New harness. | 10 to 15 |
| Nous Portal | Yes | Yes, device code | New, or Hermes | New harness. | Not now |
| Google Gemini | Yes | No | None | No headless flow. | Not now |
| Cursor, Windsurf, Z.ai, GitLab Duo, Vercel | Yes | Mixed | None | Mixed flows; no open client Agenta runs today. | Not now |
| Cerebras, Groq, Qwen, Mistral | Mixed | No OAuth | Any | No. There is nothing to connect. An API key is not a subscription. | Not applicable |

### 11. Recommended order

1. **Claude with a pasted `CLAUDE_CODE_OAUTH_TOKEN`, 1 to 2 days.** A normal write-only secret
   that the user mints once with `claude setup-token`. No login machinery, and the existing
   `claude` harness reads it.
2. **GitHub Copilot through Pi, 3 to 5 days.** The only device-code flow Agenta can ship on the
   harness it already runs. It forces the four generalizations in section 5 that every later
   provider needs. Two known traps: the refresh token never rotates, so the idempotency rule must
   compare access tokens, and the model list arrives inside the credential.
3. **Upgrade Pi to 0.85.1 before any further provider, 2 to 4 days.** Four subscription logins
   arrive with it, `registerOAuthProvider()` is gone, and `pi auth print-bearer-token` gives a clean
   handoff. Doing this after Copilot means one migration, not two.
4. **xAI SuperGrok through Pi, 4 to 6 days after the upgrade.** A device-code flow and a consumer
   plan, with no code to write beyond the picker. Confirm live that a standard SuperGrok account is
   accepted by the endpoint Pi uses.
5. **OpenRouter through Pi, 2 to 3 days after the upgrade.** Prepaid credits, not a subscription,
   but one login covers many models.
6. **Poe, 8 to 12 days, if wanted.** The vendor publishes the hosted pattern and a library for it.
   It needs a new harness and a spend guard.
7. **Later or not at all:** Google Gemini (no headless flow), Cursor, Windsurf, Z.ai, GitLab Duo,
   Vercel (no open client Agenta runs), Kimi and Nous Portal (device flows exist; Kimi through Pi
   0.85.1, Nous through a new harness).
8. **Hosted Claude login through the stock Claude Code binary** stays the shape for a full Claude
   connector: the runner hosts the unmodified binary and the user signs in to it (sections 1c, 1d).

### 12. Gaps in this survey

These could not be closed and should not be treated as answered.

- Google's own documentation still lists the consumer login, while several secondary sources say it
  was retired on 2026-06-18.
- Nothing here was tested against a live account. Every flow above is read from source or from
  vendor documentation.
