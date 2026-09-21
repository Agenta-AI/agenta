# Single-agent template loading

## Purpose

Create one ordinary agent from declared template resources so the model does not need to reconstruct known content.

## ADDED Requirements

### Requirement: One agent only

The first-version loader SHALL accept exactly one agent and reject multi-agent packages and subagent declarations as unsupported before writes.

#### Scenario: Single entry

- **WHEN** the package defines one entry agent
- **THEN** one ordinary agent is created.

#### Scenario: Deferred graph

- **WHEN** the package contains two agents or a subagent declaration
- **THEN** the response identifies multi-agent loading as not implemented and creates no partial graph.

### Requirement: Agent identity

The package SHALL include an agent name, description, and permanent instructions. The description SHALL describe the agent itself independently of any future calling-tool description.

#### Scenario: Describe agent

- **WHEN** the loader creates the agent
- **THEN** its saved name, description, and instructions match the package fields.

### Requirement: Ordinary creation settings

Template creation SHALL use the same model, harness, and sandbox selection behavior as ordinary agent creation for the same user and project. The first-version package MUST NOT override the model.

#### Scenario: Existing model preference

- **WHEN** a user with an existing model preference creates a blank agent and a template agent
- **THEN** both use the same ordinary model-selection rules.

#### Scenario: Unavailable model

- **WHEN** ordinary creation would require a model connection or reject unavailable settings
- **THEN** template creation follows that same behavior without silently picking a package model.

### Requirement: Declared skills and files

The loader SHALL install declared skills and copy declared workspace files and folders through existing resource services before first-message delivery.

#### Scenario: Resource materialization

- **WHEN** the example package is loaded
- **THEN** the declared skill is available, target-profile.md is copied, and reports exists before the first setup message is submitted.

#### Scenario: Partial copy failure

- **WHEN** a copy fails after the workflow was created and the request is retried
- **THEN** the same workflow is reused, user edits are preserved, and the first message waits for the required copy to succeed.

### Requirement: Optional configuration

All setup notes and permission overrides SHALL be optional. Workspace entries SHALL contain copy declarations only; optional workspace setup guidance SHALL live in the agent setup instructions.

#### Scenario: Minimal package

- **WHEN** a package omits setup instructions, setup notes, and policy overrides
- **THEN** validation succeeds and ordinary policy defaults apply.

#### Scenario: No file instructions

- **WHEN** a declared folder has no setup notes
- **THEN** the backend creates it without asking the agent to create it.

### Requirement: Minimal MCP option

An MCP connection option SHALL contain only its kind and server key. The loader SHALL use the server declaration and existing MCP connection services for endpoint configuration and authentication.

#### Scenario: Managed authentication

- **WHEN** the chosen MCP endpoint uses OAuth or an API key supported by the current gateway
- **THEN** the existing connection flow handles authentication without duplicated template credential fields.

#### Scenario: Unsupported transport

- **WHEN** a package declares a transport not supported by the verified deployment
- **THEN** the package is rejected with a transport-specific diagnostic before writes; OAuth support is not confused with transport support.

### Requirement: Valid and authorized configuration

The service MUST authorize the caller and project resources before writes and MUST save only native-schema-valid connection references. Missing connection configuration SHALL be carried as a setup need, not an invalid saved tool.

#### Scenario: Foreign account

- **WHEN** a request names a connection or secret owned by another project
- **THEN** it is rejected before resource mutation.

#### Scenario: Missing endpoint

- **WHEN** a supported package MCP server has no usable target-project endpoint
- **THEN** the saved agent omits that unresolved connection and the first message explains the remaining setup need.

### Requirement: Repeatable create

A repeated create with the same project-scoped request key and payload SHALL return the same agent/session. The same key with changed content MUST be rejected.

#### Scenario: Concurrent create

- **WHEN** two requests use the same project, key, and payload
- **THEN** only one agent is created and both receive the same resource identifiers.

#### Scenario: Changed payload

- **WHEN** the same key is reused for another template digest
- **THEN** the response is a conflict and does not create a second agent.
