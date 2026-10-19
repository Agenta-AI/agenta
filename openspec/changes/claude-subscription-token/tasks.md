# Implementation tasks

Not started. Mahmoud reviews the proposal, the specification and the design before any task begins.

## 1. Prove the delivery path

- [x] 1.1 With a real setup-token in a custom-provider key's extras (`CLAUDE_CODE_OAUTH_TOKEN`), run Claude Code turns on Daytona with credential hiding on. Record: the placeholder works; `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL` do not stop the OAuth token; a replaced token takes effect on the next turn; a refused token gives a provider 401. On a local runner that also mounts a Claude login, record which credential Claude Code uses. If the placeholder fails, classify the variable `local_use` (approved by Mahmoud) and update the proposal and specification to say the agent can read the token on Daytona. Stop and report to Mahmoud if any other check fails.

## 2. API

- [ ] 2.1 Add `SubscriptionProviderKind.CLAUDE` with its model, harness and display-name entries (`api/oss/src/core/secrets/enums.py`). No snapshot entry.
- [ ] 2.2 Add `PUT /secrets/{id}/subscription-token` and `SubscriptionLoginService.set_subscription_token`: project scope, edit permission, Claude rows only, prefix check, model-list check before any lock, store through the atomic update path with cache invalidation, return the redacted row. Errors `subscription_token_rejected` and `subscription_token_unverified`.
- [ ] 2.3 Test that a Claude row is refused by the login-attempt, push and failure routes.
- [ ] 2.4 Unit tests for 2.1 to 2.3, with the Anthropic call mocked at the HTTP boundary: store, refuse, unreachable, wrong kind, malformed value, other project, permission, failed replacement keeps the old token, no token in any response.

## 3. SDK

- [ ] 3.1 Key `_resolve_subscription` on the (harness, provider) pair. Resolve a Claude row on the `claude` harness to `credential_mode="env"` with one `CLAUDE_CODE_OAUTH_TOKEN` credential.
- [ ] 3.2 Name the provider in `SubscriptionLoginRequiredError` and `SubscriptionNotSupportedError` from one display-name map; make `SubscriptionConnectionMissingError` neutral.
- [ ] 3.3 Unit tests for 3.1 and 3.2.

## 4. Runner

- [ ] 4.1 Let the `authFault` option return a classified error (message and code). For a run whose model credentials include `CLAUDE_CODE_OAUTH_TOKEN`, report the adapter's `Authentication required` error (JSON-RPC -32000) or a provider 401 as `subscription_login_required` with the Claude message, excluding runner-internal 401s. Skip the credential preflight for this credential. Set the classified `detail` so the final result's `errorDetail` carries the code to batch callers.
- [ ] 4.2 Unit tests: token reaches the Claude daemon with no API key; Daytona plan makes it a Secret for `api.anthropic.com`; the adapter's `Authentication required` error on a token run gives the new result in the stream event and in the final result's `errorDetail`; internal 401 and API key runs keep their current results; the preflight skips the token.

## 5. Web

- [ ] 5.1 Regenerate the Fern client from an EE spec.
- [ ] 5.2 Extend the provider table in `subscriptionConnections.ts` with `claude` and a connect method; make the run provider pair-keyed.
- [ ] 5.3 Add `setSubscriptionTokenAtom` and the `SubscriptionTokenSteps` component.
- [ ] 5.4 Choose the dialog body by connect method at the dialog root, so the token body never mounts the device hook. Render the token steps inline in the drawer's Claude card and remove the static `ClaudeSubscriptionCard`.
- [ ] 5.5 AI providers page: real Claude cell with Connect and Manage; find rows by provider.
- [ ] 5.6 Onboarding Credits step: Claude row and toast; select the connected connection's model by id with `firstAgentModelForConnection`; name Claude in the no-model line.
- [ ] 5.7 Chat error button for `subscription_login_required`: "Open AI providers", in the shared callout and the mobile callout.
- [ ] 5.8 Unit tests: provider table, picker row, no device login for Claude, token steps states, onboarding selection with both subscriptions, starter credits and a mounted login row.

## 6. Docs and acceptance

- [ ] 6.1 Docs page: connect a Claude subscription on cloud and self-hosted.
- [ ] 6.2 Live QA with a real token on the dev stack: connect, local turn, Daytona turn, replace between turns, revoked token, and the three surfaces in the browser, recorded as video.
- [ ] 6.3 `openspec validate claude-subscription-token --strict --no-interactive`.
