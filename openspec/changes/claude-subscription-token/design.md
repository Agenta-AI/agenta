# Claude subscription token design

Status: Draft for Mahmoud's review. Not implemented.

## Context

### How a hosted ChatGPT subscription works today

A project can already hold a hosted ChatGPT subscription. The pieces are:

1. **The vault row.** The API stores a secret of kind `subscription_provider` in the project's encrypted `secrets` table (`api/oss/src/core/secrets/dtos.py:180`). Its data holds `provider`, `harnesses`, `models`, the write-only `login`, and server-owned fields such as `login_version`, `login_generation` and `login_state`. A project holds one row per provider (`services.py:625-670`). Create and update refuse every `login*` field (`services.py:116-129`), so only the server writes a login.
2. **The login.** The runner runs the ChatGPT device login. The API relays the code to the browser and stores the result on the row (`subscription_service.py:315-718`).
3. **The run.** The SDK sees a `self_managed` model connection with a slug, reads the row through `GET /secrets/` with the `secret-resolve` grant, and returns `credential_mode="runtime_provided"` with a `subscription` block (`platform/connections.py:703-765`). The runner writes the login into a per-connection Pi home, Pi refreshes it during the turn, and a publisher pushes newer logins back to the API (`environment.ts:721`, `publisher.ts:334`). When Pi's login is refused, the runner itself reports the code `subscription_login_required` (`errors.ts:993-1003`).
4. **The web app.** The AI providers page, the drawer card, the onboarding row and the picker read the row through generic helpers in `agenta-entities/src/secret/core/subscriptionConnections.ts`. The connect flow itself is device-code only, and `SubscriptionSignInDialog` starts a device login as soon as it opens (`SubscriptionSignInDialog.tsx:95-108`).

### How Claude subscriptions work today

Only through a mounted login on a self-hosted runner. The run uses `runtime_provided` with no subscription block, and the runner requires `CLAUDE_CONFIG_DIR` to point at a mounted folder (`run-plan.ts:867-880`). A Daytona run in this mode is refused. On cloud the web app shows the Claude cell as "Self-hosted only" (`AIProvidersPage.tsx:226-240`).

### What the setup-token gives us

We tested a real token on 2026-10-19:

| Request | Answer | Meaning |
| --- | --- | --- |
| `GET /v1/models` with the token | 200, the account's models | Valid token. Runs no model. |
| `POST /v1/messages/count_tokens` | 200 | Valid token. Runs no model. |
| `GET /api/oauth/profile` | 403, scope `user:profile` missing | A setup-token cannot read the plan type. |
| `POST /v1/messages` from `curl` | 429 | Anthropic refuses model calls that do not come from Claude Code. |
| `claude -p` with only `CLAUDE_CODE_OAUTH_TOKEN` | Answered | Claude Code needs nothing else. |
| Any request with a fake token | 401 | Refused token. |

The token is opaque and never rotates. Claude Code creates it with a one-year life, but nothing we can read tells us when a given token was created or when it expires.

## Goals / Non-Goals

Goals: a project can connect a pasted token, pick it in the model picker, and run the Claude Code harness on it, locally and on Daytona. The token never reaches a browser. On Daytona, when the runner hides credentials (the default), it never reaches the sandbox.

Non-goals are listed in the proposal. The main ones: no per-person ownership, no Pi harness, no browser sign-in, no per-account model list, no expiry date, no persisted "broken" state after a refused run.

## Decisions

### 1. Store the token on the existing subscription row

**Problem.** The token needs encrypted, write-only storage, a picker row and a connection state.

**Options.**

- **A. A new `claude` value of `SubscriptionProviderKind`.** The row, the encryption, the redaction, the one-per-provider rule, the picker keys and the web helpers already exist.
- **B. A custom provider key with `CLAUDE_CODE_OAUTH_TOKEN` in its extras.** This works today without any API change (`credentials.py:41`). But it shows up as an API key provider with no state, and the picker cannot tell a subscription from a key.
- **C. A new secret kind.** It repeats storage, permissions, redaction, identity and picker logic that A already has.

**Choice: A, with a narrow life cycle.** Add `CLAUDE` to the enum, with its model list (`CLAUDE_MODEL_ALIASES`), harnesses (`["claude"]`) and display name ("Claude"). Do not add it to the model-snapshot table, which exists only for older ChatGPT rows.

A Claude row has two states. It is `pending_login` from creation until a token is stored, then `ready`. Replacing the token keeps it `ready`. The stored login is `{"type": "oauth_token", "access": "<token>"}`. `login_version` and `login_generation` follow the existing write rules, and nothing new reads them. Login attempts, refresh rules, push-back and failure reports stay ChatGPT-only (`subscription_rules.py`, `subscription_service.py:494-718`). The token cannot be refreshed, so those rules should not change for Claude.

The row shows no expiry date. The token does not carry one, and a date counted from the paste would be wrong whenever someone pastes an older token. The paste step says that a token works for one year, and a refused run tells the person what to do (decision 5).

### 2. One route checks and stores the token

**Problem.** Create and update refuse `login`. Something must write the token, and only after a check.

**Options.**

- **A. `PUT /secrets/{id}/subscription-token`.** The browser creates the row with the generic create route, then sends the token to this route. Replace uses the same route.
- **B. Allow `login` on create and update for Claude rows.** It breaks the rule that only the server writes a login, and every create and update path then needs a provider branch.
- **C. One route that creates the row and stores the token together.** It saves one request. The service could reuse the create logic, so it is not much more code, but the browser then needs two different calls for connect and replace.

**Choice: A.** It keeps "only the server writes a login" true and reuses create and delete as they are. A row without a token stays `pending_login`, which the web app already shows as "Not signed in". A retry after a refused token reuses that row.

The service method is `SubscriptionLoginService.set_subscription_token`. It runs in this order:

1. Check project scope, the edit-secret permission, that the row is a Claude row, and that the value starts with `sk-ant-oat`.
2. Check the token with Anthropic (decision 3), before taking any database lock.
3. Store the login through the existing atomic update path, which also clears the vault cache (`subscription_service.py:276`). Bump version and generation and set `ready`.
4. Return the redacted row.

A refused or unchecked token changes nothing. A failed replacement keeps the old token, and the row stays `ready`.

### 3. Check the token with the model list

**Problem.** Saving a refused token makes the first run fail. The check must not use the person's quota.

**Options.**

- **A. The API calls `GET https://api.anthropic.com/v1/models`.** It is free, runs no model, and returns 200 or 401.
- **B. `POST /v1/messages/count_tokens`.** Also free, but it needs a model id in the body that we would have to keep current.
- **C. The runner runs `claude -p` once.** It proves the most but uses quota, needs a sandbox, and takes seconds.
- **D. No check.** The first run would find a bad token.

**Choice: A.** A 200 lets the token be stored. A 401 or 403 answers `subscription_token_rejected`. Any other answer or a network error answers `subscription_token_unverified`. The runner's Daytona credential preflight sends the same model-list request. It checks that a new sandbox really inserts the Secret, and it rebuilds the sandbox when it does not (`credential-preflight.ts`). For this credential it sends `Authorization: Bearer` with the `oauth-2025-04-20` beta header instead of `x-api-key`, because an OAuth token is refused with the API key header. Agenta's services send no other request with the token. A model call from our services would be refused (the 429 above), so no code may try one.

### 4. Deliver the token as an environment credential

**Problem.** The Claude Code harness must receive the token on local and Daytona sandboxes.

**Options.**

- **A. The SDK resolves a Claude row to `credential_mode="env"` with one credential, `CLAUDE_CODE_OAUTH_TOKEN`, and no subscription block.** The runner already passes environment credentials to the harness on both sandboxes (`run-plan.ts:571-718`). The variable is in the Anthropic group, so a run never mixes it with an API key (`daemon.ts:134-155`). The SDK classifies it `opaque_http`, so on Daytona the runner creates a Daytona Secret restricted to `api.anthropic.com` and the sandbox sees only a placeholder (`daytona-secret-plan.ts`). A replaced token changes the credential epoch, so a warm session restarts with the new token (`session-identity.ts:701-755`).
- **B. A subscription block, materialized as `.credentials.json` in a per-connection Claude home.** It reuses the ChatGPT machinery, but that machinery exists for refresh and push-back, which a setup-token never needs. It also puts the token on the sandbox disk.
- **C. `runtime_provided` with a mounted folder.** This is today's self-hosted path. It cannot work on cloud.

**Choice: A.** The runner needs no change for delivery. The SDK change is one branch in `_resolve_subscription`, keyed on the (harness, provider) pair instead of the harness alone (`platform/connections.py:641-646`). A Claude row with any harness other than `claude` raises `SubscriptionNotSupportedError`, with a message that names the right harness.

**Hiding on Daytona is a deployment setting.** An operator can switch credential hiding off with `AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS` (`run-plan.ts:892-916`). Then every credential, this token included, reaches the sandbox as plain text. This feature follows the same setting as API keys. It does not add its own rule.

**Facts to prove first (task 1.1).** We have not run Claude Code with a Daytona placeholder in `CLAUDE_CODE_OAUTH_TOKEN`. Claude Code builds the credential without checking the value, so it should work. The same live check also covers three other questions:

- The runner sets `ANTHROPIC_BASE_URL=https://api.anthropic.com` and model override variables from the endpoint (`runtime-policy.ts:241-325`). Does Claude Code still use the OAuth token with them set?
- On a self-hosted runner that also mounts a Claude login, the daemon still inherits `CLAUDE_CONFIG_DIR` (`daemon.ts:281`). Does the token win over the mounted login?
- Do a replaced token and a refused token behave as decisions 4 and 5 describe?

If the placeholder fails, the SDK classifies `CLAUDE_CODE_OAUTH_TOKEN` as `local_use` instead, and the token reaches the Daytona sandbox as plain text, the same way it does on a local sandbox. Mahmoud approved this outcome on 2026-10-19, so the work continues, and the proposal and specification then say that the agent can read the token on Daytona. This is a one-time classification choice made from the check, not a fallback that runs in code. If another check fails (the mounted login winning over the token, or a refusal without a recognizable 401), the work stops and goes back to Mahmoud.

### 5. The runner reports a refused token as `subscription_login_required`

**Problem.** If the person revokes the token, or Anthropic stops accepting it, the run must say so and point to the fix. Today the runner reports a provider 401 as `runner_error` with "add ANTHROPIC_API_KEY to the project vault, or log in" (`errors.ts:616-622`).

The runner never sees Anthropic's 401 for this harness. Claude Code reports `401 OAuth access token is invalid`, but the ACP adapter (`claude-agent-acp`) replaces it with a JSON-RPC -32000 error whose text is `Authentication required` (measured in task 1.1). The runner cannot use its broad authentication matcher either: `AUTH_REFUSAL` also matches "unauthorized" in tool and platform errors (`errors.ts:312-313`).

**Options.**

- **A. The runner recognizes the token by its environment binding name.** A run whose model credentials include `CLAUDE_CODE_OAUTH_TOKEN` is a Claude token run. When such a run fails with the adapter's `Authentication required` error, or with a provider 401 outside the Daytona delivery window (where the existing `credential_delivery_failed` result keeps precedence, `errors.ts:606-614`), and the failure is not one of the runner's own 401s, the runner reports the existing code `subscription_login_required` with a Claude message. This is the same code it already sends for a refused Pi login. The live stream and replays already carry the code to the web app (`agenta-chat/src/assets/trace.ts:57`, `transcriptToMessages.ts:674`). The final result does not: `run-turn.ts:2160` returns only `errorDetail`, and the SDK falls back to `agent_run_failed` without it (`sdks/python/agenta/sdk/agents/errors.py:52`). So the classified result also sets `detail` with the code, which the existing `errorDetail` contract carries to batch callers.
- **B. A new runner code, `model_authentication_failed`, that the SDK turns into `subscription_login_required` for subscription connections.** The SDK knows the connection came from a subscription row only in the handler, not in the wire parser (`wire.py:198`). The mapping would have to cover the live stream, the batch result and replays separately.
- **C. Also mark the row `needs_login`.** The picker and the providers page would show the broken state. It needs a call to the API on every refused run, plus rules for a token replaced in the meantime.

**Choice: A without C.** It needs no new wire field, no new code and no SDK change. The runner change is small: `classifyRunError` receives the run's model connection and makes this decision in its existing authentication branch, so the `authFault` option keeps its current signature. API key runs keep their current message. A self-hosted operator who puts `CLAUDE_CODE_OAUTH_TOKEN` in a custom provider gets the same message, which is also true for them.

The limit: after a refused run, the providers page still shows "Connected" until someone replaces the token.

### 6. Name the provider in subscription errors

`SubscriptionLoginRequiredError` and `SubscriptionNotSupportedError` hardcode ChatGPT (`errors.py:98,122`). Each takes the provider and reads its display name from one map in the SDK. `SubscriptionConnectionMissingError` (`errors.py:74`) cannot know the provider of a row that does not exist, so its message becomes neutral: "No subscription connection named '<slug>'."

### 7. Web: one provider table and two connect components

**Problem.** The web helpers map only ChatGPT. The connect dialog starts a device login when it opens.

**Options.**

- **A. Extend the provider table in `subscriptionConnections.ts` with `claude` (name, family `anthropic`, run provider for the `claude` harness, connect method `device` or `token`).** The dialog chooses its body from the connect method at its root. The device body keeps `useSubscriptionSignIn`. The new token body uses `SubscriptionTokenSteps` and a `setSubscriptionTokenAtom`, so opening the dialog for Claude never mounts the device hook. The drawer's Claude card renders the same `SubscriptionTokenSteps` inline.
- **B. A separate Claude dialog, card and hook.** Faster to write, but every later fix lands twice.
- **C. A generic connect-method plug-in system.** There are two providers and two methods. A table entry is enough.

**Choice: A.** The picker, the status helpers and the model candidates are already generic. Four places need care:

- `subscriptionRunProvider` changes from harness-keyed to pair-keyed, so the Claude row maps to `anthropic`.
- The AI providers page finds rows by provider instead of taking the first subscription row (`AIProvidersPage.tsx:116`).
- Onboarding selects the model of the connection the person just connected, by connection id, with the existing `firstAgentModelForConnection` helper. Today it picks any `codex` candidate and treats any subscription as ChatGPT (`useOnboardingModel.ts:150,187`).
- The chat error button for `subscription_login_required` changes from "Sign in again" to "Open AI providers" for every provider. The button already opens AI providers, and the message above it says what to do there. This avoids carrying provider context through live and replayed errors.

The Fern client is regenerated from an EE spec for the new kind and route.

## Risks / Trade-offs

- **Anthropic can refuse these tokens at any time.** Our runs always use the official Claude Code binary, and our services send only the model-list check. If Anthropic changes its rules, runs fail with the Claude message from decision 5.
- **The Daytona placeholder is unproven.** Task 1.1 settles it before other work.
- **The agent can read the token on a local sandbox, or on Daytona when hiding is switched off.** This is the same exposure an API key has in those cases today.
- **No expiry warning.** A token stops working after a year, and the person learns it from the run error.
- **A project member can spend another member's plan.** Accepted for this version. The connection belongs to the project, as ChatGPT does.
- **Self-hosted deployments without internet access cannot connect.** The check needs `api.anthropic.com`. Such a deployment could not run Claude on the token anyway.

## Migration Plan

None. The change adds a provider kind and a route. Existing ChatGPT rows are unchanged. The mounted Claude login on self-hosted deployments is unchanged, and its picker row keeps its "deployment login" name.

## Verification

- API unit tests: the route stores a token on 200; refuses on 401 and 403; refuses on network errors; refuses non-Claude rows, malformed values and other projects' rows; needs the edit permission; keeps the old token on a failed replacement; never returns the token, including in request-validation errors.
- SDK unit tests: a Claude row resolves to one `CLAUDE_CODE_OAUTH_TOKEN` env credential with no subscription block; a non-`claude` harness raises the named error; error messages name the provider, and the missing-row message is neutral.
- Runner unit tests: an `env` run with the token reaches the Claude daemon with no API key; the Daytona plan makes it a Secret for `api.anthropic.com`; the adapter's `Authentication required` error on a token run reports `subscription_login_required`; a runner-internal 401 does not; the credential preflight probes the token with the Bearer header and still rebuilds a stuck sandbox; an API key run keeps its message.
- Web unit tests: provider table, picker row, the dialog never starting a device login for Claude, token steps states, onboarding selection with both subscriptions, starter credits and a mounted login row.
- Live QA on the dev stack with a real token: connect, local turn, Daytona turn, replace between turns, revoke and see the error card, and the three connect surfaces in the browser.
