# Tool execution

## Purpose

Tools that do not need a computer run in the runner, with the same permissions as today and without a sandbox.

## ADDED Requirements

### Requirement: Gateway tools without a sandbox

Composio gateway tools (`search_tools`, `run_tool`) SHALL run from the runner through the existing `/tools/call` path and the existing gateway policy, with no sandbox and no file relay.

#### Scenario: Run a Composio tool before any command

- **WHEN** the first action of a session is `run_tool` for a Linear search
- **THEN** the tool runs and returns while no sandbox is required.

### Requirement: MCP gateway without a sandbox

MCP servers SHALL be reached through the Agenta MCP gateway from the runner, with the same per-server and per-tool permissions (`allow`, `ask`, `deny`, new-tool policy).

#### Scenario: Denied MCP tool

- **WHEN** a tool is `deny` in the server's policy
- **THEN** it is not offered to the model, as today.

### Requirement: Platform and build-kit tools

Platform tools (for example `read_config`, `commit_revision`, `test_run`), reference tools and client tools SHALL run from the runner with the same approval behavior.

#### Scenario: Commit needs approval

- **WHEN** the agent calls `commit_revision`
- **THEN** the same approval card appears and nothing is written until approved.

### Requirement: Tools from scripts

The spike SHALL decide whether scripts running in the sandbox can call Agenta tools (for example a CLI shim that calls back to the runner). If yes, those calls SHALL pass the same permission checks.

#### Scenario: Script calls a tool

- **WHEN** a skill script in the sandbox calls an Agenta tool
- **THEN** the call goes through the runner and its permission checks, or it is refused with a clear message. Decision recorded.

### Requirement: No new permission rules

The tool permission table, gateway policy and approval ladder SHALL be reused unchanged. The spike MUST NOT add a second copy of permission logic.

#### Scenario: Same decision on both providers

- **WHEN** the same agent config runs on `daytona` and on `inprocess`
- **THEN** each tool call gets the same allow, ask or deny decision.
