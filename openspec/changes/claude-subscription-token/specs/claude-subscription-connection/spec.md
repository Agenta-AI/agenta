# Claude subscription connection

## Purpose

Let a project run the Claude Code harness on a person's Claude Pro or Max plan, using a token from `claude setup-token`.

## ADDED Requirements

### Requirement: Connect with a pasted token

A project member with permission to edit secrets SHALL be able to connect a Claude subscription by pasting a token. A project SHALL hold at most one Claude subscription connection. The token MUST be checked with Anthropic before it is stored. A token that Anthropic refuses MUST NOT be stored.

#### Scenario: Valid token

- **WHEN** a member pastes a token that Anthropic accepts
- **THEN** Agenta stores it, the connection becomes ready, and the AI providers page shows Claude as connected.

#### Scenario: Refused token

- **WHEN** a member pastes a token that Anthropic refuses
- **THEN** no token is stored, the connection stays not connected, and the dialog says that Claude did not accept the token and tells the member to run `claude setup-token` again.

#### Scenario: Anthropic cannot be reached

- **WHEN** the check cannot reach Anthropic or gets an unexpected answer
- **THEN** no token is stored, and the dialog says that Agenta could not check the token and asks the member to try again.

#### Scenario: Retry after a refusal

- **WHEN** a member pastes a valid token after a refused one
- **THEN** Agenta stores it on the same connection, without creating a second one.

#### Scenario: Second connection

- **WHEN** a project already has a Claude subscription connection and a member tries to create another
- **THEN** the request is refused, and the member can replace the token of the existing connection instead.

### Requirement: Check the token without running a model

The token check SHALL ask Anthropic for the account's model list. It MUST NOT call a model. Agenta's services MUST NOT send any other request with the token.

#### Scenario: Check request

- **WHEN** Agenta checks a token
- **THEN** it sends one model-list request to Anthropic and treats only a success answer as a valid token.

### Requirement: Keep the token secret

The token SHALL be stored encrypted in the project's vault. No browser response, log line, trace or error message MUST contain it. The connection SHALL show only its state.

#### Scenario: Read the connection

- **WHEN** the web app lists the project's connections
- **THEN** the Claude connection shows its state and never the token.

#### Scenario: Another project

- **WHEN** a member of another project sends a token to this project's connection
- **THEN** the request is refused, and the connection does not change.

### Requirement: Replace and remove the token

A member with permission to edit secrets SHALL be able to replace the token or remove the connection. Replacing SHALL run the same check as connecting. Removing SHALL delete the stored token.

#### Scenario: Replace

- **WHEN** a member pastes a new valid token on a connected connection
- **THEN** no new turn uses the old token.

#### Scenario: Failed replace

- **WHEN** a member pastes a refused token on a connected connection
- **THEN** the old token stays in use, and the connection stays connected.

#### Scenario: Remove

- **WHEN** a member removes the connection
- **THEN** the token is deleted, the picker no longer shows the Claude subscription row, and agents that use it fail with a message that the connection is missing.

### Requirement: Pick the connection for an agent

A ready Claude subscription connection SHALL appear in the model picker as a "Claude" row tagged "Subscription". It SHALL offer the Claude Code harness models only.

#### Scenario: Picker

- **WHEN** a project has a ready Claude subscription connection and a member opens the model picker
- **THEN** the picker shows the Claude subscription row with the Claude Code models, separate from any Anthropic API key row.

### Requirement: Run the Claude Code harness on the token

A run that uses the Claude subscription connection SHALL run the official Claude Code harness with the token in `CLAUDE_CODE_OAUTH_TOKEN`. The run MUST NOT receive an Anthropic API key. On Daytona, when the runner hides credentials, the sandbox SHALL receive a placeholder, and the real token SHALL reach only requests to `api.anthropic.com`. The token MUST NOT be offered to any other harness.

#### Scenario: Local run

- **WHEN** an agent with the Claude subscription connection runs on a local sandbox
- **THEN** the Claude Code harness answers using the person's plan.

#### Scenario: Daytona run

- **WHEN** an agent with the Claude subscription connection runs on Daytona with credential hiding on
- **THEN** the Claude Code harness answers using the person's plan, and the environment inside the sandbox holds a placeholder, not the token.

#### Scenario: Other harness

- **WHEN** an agent config pairs the Claude subscription connection with a harness other than Claude Code
- **THEN** the run is refused before it starts, with a message that names the supported harness.

#### Scenario: Token replaced between turns

- **WHEN** the token is replaced while a session is warm
- **THEN** the next turn starts with the new token.

### Requirement: Report a refused token during a run

When Anthropic refuses the token during a run, the run SHALL fail with the code `subscription_login_required` and a message that names Claude. A refusal that the runner can attribute to a credential delivery race SHALL keep its existing retry message. A 401 from Agenta's own services during the run MUST NOT be reported as a refused token. The chat SHALL offer an "Open AI providers" action.

#### Scenario: Revoked token

- **WHEN** the person revokes the token and an agent runs on it in a warm session
- **THEN** the turn fails with `subscription_login_required`, the message names Claude, and the chat shows "Open AI providers".

#### Scenario: First turn on a new Daytona sandbox

- **WHEN** Anthropic refuses the token on the first turn after a Daytona sandbox starts
- **THEN** the turn reports a credential delivery problem and asks for a retry, and the next turn reports the refused token.

#### Scenario: Internal 401

- **WHEN** a tool call to Agenta's own services answers 401 during a run on the token
- **THEN** the turn does not report a refused token.

### Requirement: Connect from three places

The connect flow SHALL be available on the AI providers page, in the model providers drawer, and in the Credits step of the new onboarding flow. The page and onboarding SHALL open the shared connect dialog. The drawer SHALL show the same steps inside its Claude card. Opening the connect flow for Claude MUST NOT start a ChatGPT device login.

#### Scenario: Onboarding

- **WHEN** a new user connects a Claude subscription in the Credits step
- **THEN** the step shows the Claude row as in use, and the first agent runs on a model of the Claude connection.

#### Scenario: Onboarding with both subscriptions

- **WHEN** a new user connects ChatGPT and then Claude in the Credits step
- **THEN** the first agent runs on the connection connected last, and only that row shows as in use.
