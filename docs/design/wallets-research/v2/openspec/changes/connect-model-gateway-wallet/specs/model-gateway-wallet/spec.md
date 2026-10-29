## ADDED Requirements

### Requirement: Shared ports and disabled behavior
The gateway SHALL own admission and usage-reporting contracts with null implementations; the enterprise wallet integration SHALL implement them without exposing wallet tables to gateways.

#### Scenario: Flag off or open source
- **WHEN** billing integration is disabled or unavailable
- **THEN** existing model behavior continues without wallet writes or admission rejection

#### Scenario: Enabled managed call
- **WHEN** a platform-funded model request arrives
- **THEN** the gateway invokes admission before contacting the provider and emits usage through the shared reporting contract

### Requirement: Funding boundary
The original-phase implementation SHALL distinguish Agenta-funded calls from customer-funded calls using trusted namespace and credential-origin information.

#### Scenario: Own credential with empty wallet
- **WHEN** a customer-funded model request passes normal permissions
- **THEN** wallet depletion does not deny or charge that provider usage

#### Scenario: Refused admission
- **WHEN** the wallet refuses a managed request or cannot answer
- **THEN** the provider is not contacted and a visible refusal is returned

### Requirement: Actual model usage
The gateway SHALL capture supported non-streaming and streaming input, output and cache usage with one measurement identity and run attribution where available.

#### Scenario: Interrupted stream
- **WHEN** a provider stream ends early
- **THEN** known billable usage is recorded accurately and unknown usage is not invented

#### Scenario: Cache accounting
- **WHEN** a protocol reports cached input separately
- **THEN** the measurement preserves the split without counting cached input twice

#### Scenario: Replay
- **WHEN** a measurement or debit is redelivered
- **THEN** one measurement produces one posting even when settlement splits funding

### Requirement: Versioned asynchronous pricing
The original phase SHALL replace fixture pricing with a versioned rate card in the measurement worker, stamp the applied version, preserve supported fixture MCP pricing behavior, and reject unsupported paid rates rather than silently treating them as free.

#### Scenario: Rate change
- **WHEN** a new rate version is activated
- **THEN** existing settled charges retain their applied version and value

#### Scenario: Mock-only proof
- **WHEN** only a mock managed endpoint is available
- **THEN** acceptance is described as mock billing proof, not live funded-provider readiness

### Requirement: Explicit original-phase limits
The original phase SHALL document non-reserving admission, a carried but unenforced ceiling, and the best-effort first usage handoff as limits, not financial guarantees.

#### Scenario: Paid launch assessment
- **WHEN** this phase passes its mock acceptance tests
- **THEN** strict spending protection, lost-usage recovery, provider confirmation and production configuration remain separately assessed
