## ADDED Requirements

### Requirement: Separate benefit display
Settings SHALL display platform entitlement, included resource allowance and wallet lots separately, with expiry/reset and permitted purchase actions.

#### Scenario: Lifetime empty wallet
- **WHEN** a lifetime customer has remaining included compute but no credits
- **THEN** the interface shows that compute remains available and offers independent top-up where eligible

#### Scenario: Partial coverage
- **WHEN** one action consumes included units and purchased credit
- **THEN** one action row shows both portions without double-counting split debit rows

### Requirement: Authorized reconciled history
Usage queries SHALL enforce organization/project permissions and reconcile posted charges, pending amounts, grants and adjustments with financial records.

#### Scenario: Filtered history
- **WHEN** a permitted user filters by date, project, actor, agent, session or action where recorded
- **THEN** results preserve attribution and do not expose another organization

#### Scenario: Trace cleanup
- **WHEN** underlying trace data expires
- **THEN** retained financial records still explain the charge without requiring that trace

### Requirement: Evidence-based release
A release SHALL record enabled/disabled capabilities, exact revisions, applicable tests, provider evidence, monitoring and rollback with explicit approval.

#### Scenario: Documentation validation
- **WHEN** OpenSpec strict validation passes
- **THEN** only document validity is claimed, not deployed behavior

#### Scenario: Partial delivery
- **WHEN** foundation work is ready but sandbox or a connector is not
- **THEN** the unrelated work stays open rather than blocking a foundation-only release
