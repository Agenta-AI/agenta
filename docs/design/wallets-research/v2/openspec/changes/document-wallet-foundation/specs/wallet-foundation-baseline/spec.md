## ADDED Requirements

### Requirement: Organization accounting
The foundation SHALL keep immutable credit and debit history and mutable general and per-credit balances in one organization-scoped transactional store.

#### Scenario: Split settlement
- **WHEN** one posting uses multiple eligible credits
- **THEN** all debit rows and balance changes commit together, or none do

#### Scenario: Posting replay
- **WHEN** the same organization posting is delivered concurrently or again
- **THEN** the posting has one financial effect, guarded by organization locking and per-source debit identity

### Requirement: Non-reserving admission
The baseline SHALL describe check as a spendable-balance-versus-floor comparison, not an action price check or reservation. The spendable balance is the general balance minus the remaining value of credits that have expired, read in one statement.

#### Scenario: Concurrent admission
- **WHEN** two calls check the same balance
- **THEN** a successful check does not imply funds have been reserved for either call

#### Scenario: Missing balance
- **WHEN** an existing organization has no general balance row
- **THEN** the check lazily provisions the row and compares its spendable balance with the applicable floor; it does not restore missed grants

#### Scenario: Expired credit value
- **WHEN** the only remaining credit value belongs to a credit whose end time has passed
- **THEN** the check does not count that value, while the general balance row itself still includes it until an expiry debit exists

### Requirement: Funding and settlement rules
The baseline SHALL preserve the branch signup award, plan-change adjustment, credit selection and deficit behavior without presenting code constants as newly approved commercial terms.

#### Scenario: Signup replay
- **WHEN** a signup award is retried
- **THEN** its configured activity identity prevents a duplicate grant, and a unique index on the award identity rejects a second credit

#### Scenario: Missed signup grants
- **WHEN** organizations were created while the wallet flag was off
- **THEN** an operator can run the one-off signup-grant backfill job, which is a dry run by default and awards at most one signup grant per eligible organization

#### Scenario: Selection
- **WHEN** a debit is settled
- **THEN** the branch selects eligible credits by priority, expiry and credit ID, including restricted resource prefixes, and judges expiry by one database clock reading taken after the organization lock

#### Scenario: Insufficient funding after usage
- **WHEN** a posting exceeds available eligible credit
- **THEN** the branch records the unfunded remainder as deficit rather than dropping consumed usage

#### Scenario: Plan change
- **WHEN** a plan change is applied with wallets enabled
- **THEN** one per-organization lock serializes it from reading the plan through the wallet adjustment, the newest plan-allowance credit not already clawed back loses the unused share of its own lifetime, and the incoming allowance is prorated from the change's effective time over the subscription's billing period

#### Scenario: Repeated plan-change submission
- **WHEN** the same plan switch is submitted twice
- **THEN** the second submission reads the new plan and changes nothing, while the same transition made again later in the period is a new change that moves money again

#### Scenario: Failed plan-change adjustment
- **WHEN** the wallet adjustment fails after the subscription change committed
- **THEN** the baseline records that the failure is logged and not retried, and that this gap blocks enabling wallets for paying customers

### Requirement: Measurement delivery limits
The baseline SHALL record that the initial stream publication is best-effort and subsequent measurement persistence and debit settlement are replay-safe.

#### Scenario: Accepted publication
- **WHEN** a measurement message reaches the stream and processing retries
- **THEN** measurement identity and posting identity prevent duplicate financial effects

#### Scenario: Failed initial publication
- **WHEN** the initial stream write fails, or the publisher refuses it because the stream backlog is at its limit
- **THEN** the baseline does not claim durable recovery or guaranteed recording; a measurement and charge can be lost

#### Scenario: Unacceptable stream entry
- **WHEN** a worker judges an entry terminal, or the entry keeps failing past its maximum deliveries
- **THEN** the entry is written to the stream's dead-letter stream before it leaves the source stream, and an operator can list and replay it

#### Scenario: Stream backlog limit
- **WHEN** a wallet stream's unprocessed backlog reaches its limit
- **THEN** the publisher refuses and logs the new entry, and no pending entry is trimmed

#### Scenario: Conflicting measurement replay
- **WHEN** a measurement identity is replayed with different content
- **THEN** the stored measurement is unchanged, the entry is dead-lettered, and it is not priced

### Requirement: Feature-flag and migration boundary
The baseline SHALL distinguish flag-gated runtime paths from unconditional schema migrations.

#### Scenario: Disabled runtime
- **WHEN** AGENTA_WALLETS_ENABLED is false
- **THEN** wallet hooks, wallet consumers and the plan-change lock are disabled while migrations and their backfill can still run

#### Scenario: Implemented versus released
- **WHEN** the branch contains the foundation
- **THEN** the documentation reports implemented on the PR branch, not merged, deployed, or production-accepted
