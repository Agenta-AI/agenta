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
The baseline SHALL describe check as a general-balance-versus-floor comparison, not an action price check or reservation.

#### Scenario: Concurrent admission
- **WHEN** two calls check the same balance
- **THEN** a successful check does not imply funds have been reserved for either call

#### Scenario: Missing balance
- **WHEN** an existing organization has no general balance row
- **THEN** the check lazily provisions the row and compares its balance with the applicable floor; it does not restore missed grants

### Requirement: Funding and settlement rules
The baseline SHALL preserve the branch signup award, plan-change adjustment, credit selection and deficit behavior without presenting code constants as newly approved commercial terms.

#### Scenario: Signup replay
- **WHEN** a signup award is retried
- **THEN** its configured activity identity prevents a duplicate grant

#### Scenario: Selection
- **WHEN** a debit is settled
- **THEN** the branch selects eligible unexpired credits by priority, expiry and credit ID, including restricted resource prefixes

#### Scenario: Insufficient funding after usage
- **WHEN** a posting exceeds available eligible credit
- **THEN** the branch records the unfunded remainder as deficit rather than dropping consumed usage

### Requirement: Measurement delivery limits
The baseline SHALL record that the initial stream publication is best-effort and subsequent measurement persistence and debit settlement are replay-safe.

#### Scenario: Accepted publication
- **WHEN** a measurement message reaches the stream and processing retries
- **THEN** measurement identity and posting identity prevent duplicate financial effects

#### Scenario: Failed initial publication
- **WHEN** the initial stream write fails
- **THEN** the baseline does not claim durable recovery or guaranteed recording; a measurement and charge can be lost

### Requirement: Feature-flag and migration boundary
The baseline SHALL distinguish flag-gated runtime paths from unconditional schema migrations.

#### Scenario: Disabled runtime
- **WHEN** AGENTA_WALLETS_ENABLED is false
- **THEN** wallet hooks and wallet consumers are disabled while migrations and their backfill can still run

#### Scenario: Implemented versus released
- **WHEN** the branch contains the foundation
- **THEN** the documentation reports implemented on the PR branch, not merged, deployed, or production-accepted
