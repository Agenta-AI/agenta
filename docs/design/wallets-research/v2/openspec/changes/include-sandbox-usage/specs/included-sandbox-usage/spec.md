## ADDED Requirements

### Requirement: Independent included compute
The platform SHALL represent included sandbox usage as an entitlement-backed resource quantity, not a general-purpose wallet grant.

#### Scenario: Empty wallet
- **WHEN** an authorized customer has 600 included seconds for the configured machine class and uses 90 billable seconds
- **THEN** 510 included seconds remain and the wallet is not debited

#### Scenario: Resource isolation
- **WHEN** a customer has included sandbox seconds but no wallet credit
- **THEN** those seconds cannot fund an Agenta-paid model or managed tool

### Requirement: Periods without subscriptions
Included usage SHALL support configured periods and machine classes independently of recurring subscription payment events.

#### Scenario: Lifetime reset
- **WHEN** a lifetime organization enters its next configured usage period
- **THEN** the new allowance becomes available without a Stripe subscription or wallet mint

#### Scenario: Boundary execution
- **WHEN** a sandbox spans a period boundary
- **THEN** usage is attributed deterministically to the defined periods without spending either period twice

### Requirement: Included-first funding
Sandbox admission SHALL consume included coverage before permitted wallet-funded overage and SHALL keep non-overridable platform limits separate.

#### Scenario: Overage disabled
- **WHEN** included usage is exhausted even though the wallet is funded
- **THEN** further execution stops at a safe enforceable boundary and explains the quota limit

#### Scenario: Overage enabled
- **WHEN** a 90-second interval has 30 included seconds left and enough eligible credit
- **THEN** 30 seconds use included coverage and only the remaining 60 seconds are priced at the pinned applicable rate

#### Scenario: No funding
- **WHEN** both included coverage and permitted wallet funds are exhausted
- **THEN** the platform does not authorize another billable execution interval

### Requirement: Bounded concurrent execution
The platform SHALL reserve coverage before a bounded execution interval, settle measured usage once, and release unused coverage without trusting sandbox-controlled duration reports.

#### Scenario: Competing runs
- **WHEN** two runs request the final included seconds
- **THEN** atomic accounting prevents the same seconds from funding both

#### Scenario: Crash and retry
- **WHEN** the controller crashes after provider dispatch
- **THEN** durable identity allows usage reconciliation; reservations are not released blindly while provider work may continue

#### Scenario: Mixed funding failure
- **WHEN** an interval needs both allowance and wallet coverage but wallet reservation fails
- **THEN** no interval starts and the included reservation is safely released

#### Scenario: Provider still billing
- **WHEN** a run is idle, interrupted or stopped
- **THEN** accounting follows the defined provider-billable lifecycle and does not assume agent response completion ended provider cost

### Requirement: Independent resource accounting
Sandbox usage SHALL remain separate from run counts, trace counts, model tokens and managed-tool units.

#### Scenario: Customer model key
- **WHEN** a run uses the customer's model credentials
- **THEN** provider model charges are not billed as Agenta-funded tokens, but included or paid sandbox accounting still applies

#### Scenario: Machine sizes
- **WHEN** a customer changes compute class
- **THEN** the configured class-specific allowance/rate or explicit normalized conversion is applied, not one unqualified second across all machines

#### Scenario: History
- **WHEN** usage is fully included
- **THEN** the system still records usage and known provider cost with zero customer credit charge
