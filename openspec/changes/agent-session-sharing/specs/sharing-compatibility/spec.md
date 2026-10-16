## ADDED Requirements

### Requirement: Legacy access preservation
The upgrade SHALL preserve current role identifiers, default capabilities, prompts, evaluators, evaluations, test sets, and their session access.

#### Scenario: Existing agent
- **WHEN** an existing agent is migrated
- **THEN** its visibility SHALL be project and valid attribution SHALL remain recorded.

#### Scenario: Legacy evaluation
- **WHEN** an evaluation session shares the same storage as agent sessions
- **THEN** the agent-chat migration SHALL NOT change its access.

#### Scenario: Known human chat
- **WHEN** independent persisted evidence identifies an active human creator of an old web agent chat
- **THEN** the migration SHALL assign that owner and private visibility.

#### Scenario: Unknown chat owner
- **WHEN** creator evidence is missing, ambiguous, or identifies an inactive member
- **THEN** the chat SHALL remain project-visible and SHALL require explicit valid owner assignment before privatization.

#### Scenario: API-key attribution
- **WHEN** created_by_id identifies a key creator without proof of interactive creation
- **THEN** the migration SHALL NOT treat that field alone as verified human ownership.

### Requirement: Trace and analytics baseline
This change SHALL preserve trace storage, ingestion, filtering, and current VIEW_SPANS assignments. Agent/session privacy SHALL NOT be represented as hiding content from project trace readers.

#### Scenario: Existing analytics user
- **WHEN** a user currently has trace and analytics access
- **THEN** the default upgrade SHALL retain that access.

#### Scenario: Private conversation trace
- **WHEN** a project trace reader opens captured content from a private session
- **THEN** the existing trace policy SHALL continue to apply and the sharing interface SHALL disclose this exception.

#### Scenario: Explicit restricted policy
- **WHEN** a deployment deliberately enforces admin-only trace access
- **THEN** non-admin analytics guarded by VIEW_SPANS SHALL be denied; unavailable metrics SHALL NOT display as zero.

#### Scenario: Future metrics split
- **WHEN** usage-only analytics are requested without trace content access
- **THEN** the implementation SHALL require a separately reviewed capability and bounded endpoint rather than relabeling unrestricted trace queries.
