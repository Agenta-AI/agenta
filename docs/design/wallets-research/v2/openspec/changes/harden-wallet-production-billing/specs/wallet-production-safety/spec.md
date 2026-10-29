## ADDED Requirements

### Requirement: Action-aware funding
For an enabled paid action requiring bounded spend, admission SHALL validate entitlement, action identity, eligible unexpired funding and a bounded reservation or an explicitly approved alternative exposure policy before dispatch.

#### Scenario: Concurrent spending
- **WHEN** two fixed-price actions compete for the last available funds
- **THEN** they cannot both reserve the same value

#### Scenario: Expired funds
- **WHEN** credit expiry has passed
- **THEN** that value is excluded from both admission and the displayed spendable balance

#### Scenario: Different entry point
- **WHEN** the same Agenta-funded capability is invoked through REST or MCP
- **THEN** the same financial checks apply once; no transport bypass or double billing occurs

### Requirement: Durable financial recovery
The paid-launch implementation SHALL retain a recoverable identity for funding, plan transitions and billable execution outcomes, without mutating historical postings.

#### Scenario: Repeated real transitions
- **WHEN** a customer changes plan twice in one period and either event retries
- **THEN** each genuine transition has a distinct identity and each retry has one effect

#### Scenario: Failed adjustment
- **WHEN** a subscription update succeeds but its wallet adjustment fails
- **THEN** the adjustment is durably pending and recoverable

#### Scenario: Unknown outcome
- **WHEN** a provider times out after possible billable work
- **THEN** the request is reconciled under the original execution identity instead of blindly re-executed

#### Scenario: Poison message
- **WHEN** a message cannot be processed
- **THEN** its failure is inspectable and recoverable under a defined terminal-message policy rather than disappearing without evidence

### Requirement: Price and cost evidence
Paid usage SHALL preserve the applicable customer rate version and provider cost units without silently repricing historical usage or inferring missing provider costs.

#### Scenario: Catalog change
- **WHEN** a provider adds a model with no validated rate
- **THEN** the managed paid route stays unavailable until configured

#### Scenario: Delayed processing
- **WHEN** usage arrives after a price change
- **THEN** the configured effective-date/request-price rule selects the intended rate deterministically

### Requirement: Selective release
Release approval SHALL state enabled capabilities, applicable evidence, disabled work and rollback, without requiring all deferred architecture to ship.

#### Scenario: Original open item
- **WHEN** a design question has no confirmed policy
- **THEN** the register keeps it open with an owner/action recommendation, not an invented accepted answer

#### Scenario: Foundation-only release
- **WHEN** the foundation merges with paid paths disabled
- **THEN** live sandbox, connector, checkout and analytics work remains separately tracked
