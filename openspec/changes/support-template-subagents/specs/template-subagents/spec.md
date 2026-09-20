# Future template subagents

## Purpose

Define future multi-agent template behavior separately from the single-agent version, with no claim that these capabilities are implemented.

## ADDED Requirements

### Requirement: Separate agent and tool descriptions

A future agent definition SHALL own its description. A reference to that agent SHALL allow optional `tool_description` describing when the caller should use it, plus optional permission, input schema, and setup notes.

#### Scenario: Default calling description

- **WHEN** a future reference omits tool_description and permission
- **THEN** the called agent description and existing native permission defaults are used.

#### Scenario: Specific calling purpose

- **WHEN** a future reference supplies tool_description
- **THEN** the calling tool uses it without replacing the agent description.

### Requirement: General agent-management tools

Future creation and editing of child agents SHALL use general agent-management capabilities with target-project authorization, not template-specific installation operations.

#### Scenario: Child setup

- **WHEN** the entry agent needs to connect and configure a child
- **THEN** a general authorized agent-management operation handles that change; no installation-scoped tool is required.

### Requirement: Finite graph handling

Future loading SHALL create each declared agent once and resolve references only after identities exist. Any graph projection SHALL visit each agent key once and emit each agent/connection slot once.

#### Scenario: Shared child or mutual link

- **WHEN** a package references a shared child or contains A to B and B to A
- **THEN** resource loading and any projection terminate without duplicate agents or slots.

### Requirement: Bounded synchronous calls

Future synchronous calls MUST reject a target already present in the call chain and enforce a maximum depth. The chain SHALL start with the entry workflow identity.

#### Scenario: Cycle from entry

- **WHEN** A starts a run and calls B, which tries to call A
- **THEN** the second A execution is rejected before it starts.

#### Scenario: Independent later run

- **WHEN** B starts a separate later run and calls A
- **THEN** the completed earlier chain does not block that independent call.

### Requirement: Honest validation status

First-version reports SHALL label this capability NOT IMPLEMENTED, and SHALL NOT count schema validity as runtime acceptance.

#### Scenario: Version-one validation

- **WHEN** the single-agent loader is validated
- **THEN** multi-agent runtime scenarios are reported as NOT IMPLEMENTED, not passed or silently omitted.
