# Run agents on a Claude subscription with a pasted token

Status: Draft for Mahmoud's review. Not implemented.

## Why

People who pay for Claude Pro or Max want their Agenta agents to run on that plan instead of an Anthropic API key.

Today this works only on a self-hosted deployment. The operator mounts their own Claude login folder into the runner, and the run reads it through `CLAUDE_CONFIG_DIR`. On Agenta Cloud the Claude cell on the AI providers page is greyed out with "Self-hosted only", and a Daytona run with `runtime_provided` credentials is refused.

Claude Code has a command for this case. `claude setup-token` signs the person in through their browser and prints a token that lasts one year. Claude Code reads it from the `CLAUDE_CODE_OAUTH_TOKEN` environment variable. The token does not rotate, so nothing has to refresh it or write it back.

## What Changes

- Add a Claude subscription connection to a project. The person runs `claude setup-token` on their own computer and pastes the token into Agenta. It is a second kind of the existing hosted subscription connection, next to ChatGPT.
- Check the token before saving it. Agenta asks Anthropic for the account's model list, which costs nothing and runs no model. A refused token is never saved.
- Store the token encrypted and write-only, like the ChatGPT login.
- Show the connection as a "Claude · Subscription" row in the model picker, with the Claude Code harness models.
- Deliver the token to the Claude Code harness as `CLAUDE_CODE_OAUTH_TOKEN`, on local and Daytona sandboxes. On Daytona, when the runner hides credentials (the default), the sandbox receives a placeholder, and Daytona puts the real token only into requests to `api.anthropic.com`.
- When Anthropic refuses the token during a run, the runner reports `subscription_login_required` with a message that names Claude. The chat offers "Open AI providers" for every subscription.
- Add the connect flow to three places: the AI providers page, the model providers drawer, and the Credits step of the new onboarding flow.

## Capabilities

### New Capabilities

- `claude-subscription-connection`: connect, check, store, replace and remove a pasted Claude token; pick it as a model connection; run the Claude Code harness on it; report a refused token.

### Modified Capabilities

None. The hosted ChatGPT subscription has no archived OpenSpec capability.

## Out of scope

- Limiting a connection to the person who added it. Like ChatGPT, the connection belongs to the project, and every member can run agents on it.
- Running the Pi harness on a Claude token. Only the Claude Code harness uses the token.
- A browser sign-in inside Agenta. The person runs one command on their own computer.
- Reading the plan type (Pro or Max) or the remaining quota. A setup-token cannot read the profile.
- A model list per account. The picker keeps the fixed Claude Code model list.
- Marking the connection as broken after a refused run. The run error tells the person what to do. The connection itself changes only when someone pastes, replaces or removes a token.
- An expiry date or an expiry warning. The token does not say when it expires, so the person learns it from the run error.
- Changes to the existing mounted Claude login for self-hosted deployments.

## Impact

- API: one new provider kind, one route that checks and stores a token, and its tests.
- SDK: resolve a Claude subscription row to an environment credential; name the provider in subscription errors.
- Runner: report a provider refusal on a Claude token run as `subscription_login_required`. Token delivery reuses the existing environment credential path.
- Web: the connect dialog, the drawer card, the AI providers cell, the onboarding row, the picker row and the error card copy. The generated API client gains the `claude` kind.
- Docs: one page on connecting a Claude subscription.

## Confirmed direction

Confirmed by Mahmoud on 2026-10-19: build it for Agenta Cloud and self-hosted; follow the approved screen designs; the connection belongs to the project; verify the token without running a model.
