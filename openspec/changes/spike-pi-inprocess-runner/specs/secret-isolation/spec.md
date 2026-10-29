# Secret isolation

## Purpose

The agent can use credentials without being able to read them.

## ADDED Requirements

### Requirement: Model credentials stay in the runner

The model API key or subscription login SHALL live only in the session's in-memory credential store in the runner. It MUST NOT be sent to the sandbox or shown to the model.

#### Scenario: Agent prints its environment

- **WHEN** the agent runs `env` in the sandbox
- **THEN** no model key or subscription token appears.

### Requirement: ChatGPT subscription works

A Pi session with a hosted ChatGPT subscription SHALL authenticate, refresh its token mid-turn, and publish the new token to the API. The existing rules hold: never write back an older token, never log a token, the API decides which login is current.

#### Scenario: Token refresh during a turn

- **WHEN** the access token expires during a long turn
- **THEN** Pi refreshes it, the turn continues, and the API holds the new token.

### Requirement: Drive credentials in the sandbox

The command sandbox SHALL hold only credentials scoped to the session folder's and the agent folder's prefixes of the drive (in the geesefs process, as on `daytona`). The agent's conversation file SHALL be in a prefix those credentials cannot reach.

#### Scenario: The agent reads its mount credentials

- **WHEN** a command reads the credentials geesefs holds in the sandbox
- **THEN** they reach only the two folders the sandbox already mounts, and not the conversation file.

### Requirement: MCP secrets stay server-side

MCP server credentials SHALL stay in the MCP gateway. The runner holds only the short-lived Agenta credential it uses today.

#### Scenario: MCP call

- **WHEN** the agent calls an MCP tool
- **THEN** the upstream secret never enters the runner session or the sandbox.

### Requirement: Custom secrets usable, not readable

A project secret bound to the sandbox (today `sandbox.credentials`) SHALL be usable by commands for its intended host. The spike SHALL test whether the model can read its value, and record the result for each option tried.

#### Scenario: Secret in a command

- **WHEN** the agent runs `curl` with `$MY_API_KEY` to the allowed host
- **THEN** the request authenticates.

#### Scenario: Secret echoed

- **WHEN** the agent runs `echo $MY_API_KEY`
- **THEN** the output does not show the real value (target behavior; record if an option cannot meet it).
