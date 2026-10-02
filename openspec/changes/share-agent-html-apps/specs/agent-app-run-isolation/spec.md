# Agent app run isolation delta

## Purpose

Define when an agent-made HTML app may run with its file bridge, how the bridge recovers from a token the server cannot use, what the page shows when the app document cannot be built, and what environment agent processes get, so an app never runs with more access than its own folder.

## ADDED Requirements

### Requirement: Run needs a folder scope
Run mode SHALL start only after the server has issued a scope for the app's folder. If the scope cannot be issued, Run SHALL NOT start and SHALL show an error. An HTML file at the root of a drive SHALL NOT run in Run mode. Preview SHALL still work for it.

#### Scenario: Scope request fails
- **WHEN** the scope request for an app folder fails
- **THEN** Run SHALL NOT start, and the app SHALL NOT make any file call.

#### Scenario: HTML file at the drive root
- **WHEN** a person opens `index.html` at the root of a drive
- **THEN** the Run action SHALL NOT be offered, and Preview SHALL work.

### Requirement: A token the server cannot use is replaced once
The server SHALL report a scope token it cannot use (bad signature, malformed, unknown version, or expired) as `scope_token_invalid`, and a valid token used outside its grant as `scope`. On `scope_token_invalid`, the page SHALL drop the cached token, get a new one, and retry the call once. If the retry fails, the call SHALL fail. On `scope`, the page SHALL NOT retry.

#### Scenario: Signing key changed while an app is open
- **WHEN** the API starts with a new scope signing key while a person has an app open in Run mode
- **THEN** the app's next file call SHALL succeed after one new token, and later calls SHALL use the new token.

#### Scenario: Request outside the folder
- **WHEN** an app asks for a file outside its folder
- **THEN** the call SHALL fail with `scope`, and the page SHALL NOT get a new token.

### Requirement: A failed build never renders raw HTML
When the page cannot build an app or preview document, it SHALL show an error document under the same content policy. It SHALL NOT render the original HTML without that policy.

#### Scenario: Asset read throws
- **WHEN** reading one of the app's assets fails while the document is built
- **THEN** the frame SHALL show an error, and no script from the app SHALL run.

### Requirement: Agent processes get only the environment the runner lists
The environment of an agent process started by the local runner SHALL hold only the variables the runner lists for that run. Every other variable of the runner's own environment SHALL be empty in the agent process. Agent processes SHALL NOT receive the runner token or an Agenta API key, in local mode or in Daytona mode.

#### Scenario: Local runner with an API key set
- **WHEN** the operator sets `AGENTA_API_KEY` for the runner and an agent runs a shell command that prints its environment
- **THEN** the output SHALL NOT contain a value for `AGENTA_API_KEY` or `AGENTA_RUNNER_TOKEN`.

#### Scenario: Provider key of another provider
- **WHEN** the runner has `ANTHROPIC_API_KEY` set and a managed run uses an OpenAI model
- **THEN** the agent process SHALL NOT receive a value for `ANTHROPIC_API_KEY`.
