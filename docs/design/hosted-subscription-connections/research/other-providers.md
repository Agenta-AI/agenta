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

