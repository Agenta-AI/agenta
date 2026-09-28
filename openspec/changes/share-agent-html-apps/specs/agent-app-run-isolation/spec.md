# Agent app run isolation delta

## Purpose

Define when an agent-made HTML app may run with its file bridge, and what the page shows when the app document cannot be built, so an app never runs with more access than its own folder.

## ADDED Requirements

### Requirement: Run needs a folder scope
Run mode SHALL start only after the server has issued a scope for the app's folder. If the scope cannot be issued, Run SHALL NOT start and SHALL show an error. An HTML file at the root of a drive SHALL NOT run in Run mode. Preview SHALL still work for it.

#### Scenario: Scope request fails
- **WHEN** the scope request for an app folder fails
- **THEN** Run SHALL NOT start, and the app SHALL NOT make any file call.

#### Scenario: HTML file at the drive root
- **WHEN** a person opens `index.html` at the root of a drive
- **THEN** the Run action SHALL NOT be offered, and Preview SHALL work.

### Requirement: A failed build never renders raw HTML
When the page cannot build an app or preview document, it SHALL show an error document under the same content policy. It SHALL NOT render the original HTML without that policy.

#### Scenario: Asset read throws
- **WHEN** reading one of the app's assets fails while the document is built
- **THEN** the frame SHALL show an error, and no script from the app SHALL run.

### Requirement: Agent processes get no platform credentials
Agent processes started by the runner SHALL NOT receive the runner token or an Agenta API key in their environment, in local mode or in Daytona mode.

#### Scenario: Local runner with an API key set
- **WHEN** the operator sets `AGENTA_API_KEY` for the runner and an agent runs a shell command that prints its environment
- **THEN** the output SHALL NOT contain `AGENTA_API_KEY` or `AGENTA_RUNNER_TOKEN`.
