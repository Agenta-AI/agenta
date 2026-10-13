## ADDED Requirements

### Requirement: Explicit action catalog
Each managed integration SHALL expose only registered actions with validated inputs, stable output contracts and defined billable units.

#### Scenario: Unsupported operation
- **WHEN** a caller submits a raw upstream operation not in the managed catalog
- **THEN** the request is rejected before credentials are resolved or provider dispatch occurs

#### Scenario: Provider change
- **WHEN** an action moves from Composio to a verified direct API implementation
- **THEN** its public contract remains compatible or receives an explicit version change

### Requirement: Trusted execution context
Identity, integration route, credential reference, funding mode, price version and execution identity SHALL be derived from authorized server context, not model arguments.

#### Scenario: Forged funding
- **WHEN** model arguments request another organization or platform account
- **THEN** they cannot override trusted execution context

#### Scenario: Platform credential
- **WHEN** a managed action executes
- **THEN** the provider credential is resolved server-side and is not returned to the agent or exposed as an unrestricted customer connection

### Requirement: One financial boundary
Every entry point for an Agenta-funded managed action SHALL call the shared authorization and usage-billing boundary exactly once per economic execution.

#### Scenario: REST or MCP
- **WHEN** the action enters through either supported transport
- **THEN** normal permission/approval policy and identical funding checks apply

#### Scenario: Denied request
- **WHEN** permission or funding is refused
- **THEN** the provider is not contacted

#### Scenario: Customer-owned account
- **WHEN** a separately authorized action uses customer-owned credentials
- **THEN** it is not charged as an Agenta-funded provider action; any platform fee requires its own explicit configuration

### Requirement: Evidence-based settlement
Implementations SHALL return usage evidence separately from public action results and SHALL handle provider-billable failures and unknown outcomes without assuming retries are free.

#### Scenario: Billable failure
- **WHEN** the provider reports charged work despite an unsuccessful user result
- **THEN** settlement follows the configured documented rule and records the failure

#### Scenario: Timeout
- **WHEN** a billable result cannot be confirmed
- **THEN** the execution retains its identity for reconciliation and is not automatically repeated as a fresh purchase

#### Scenario: Duplicate execution request
- **WHEN** the same execution identity is retried
- **THEN** the service returns or reconciles the original outcome rather than creating a second paid action
