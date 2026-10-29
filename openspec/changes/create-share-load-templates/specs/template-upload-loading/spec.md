## ADDED Requirements

### Requirement: Upload and session-file loading

The load endpoint SHALL accept an authorized uploaded zip or session-file zip reference and pass it through the same parser/compiler/load path as internal templates. It SHALL preserve existing permission, idempotency, connection setup and first-message behavior. A new mandatory install preview SHALL NOT be required.

#### Scenario: Export and load

- **WHEN** a user uploads a zip exported by create-template and requests creation
- **THEN** a new agent and first session are created with the exported instructions, skills, setup and seed files

#### Scenario: Load a session file

- **WHEN** a user supplies a zip path in an authorized session drive
- **THEN** the loader resolves only that drive file and uses the same bounded archive resolver as uploaded zips
- **AND** a laptop-local path requires upload rather than backend filesystem access

#### Scenario: Invalid archive

- **WHEN** the zip is malformed, escapes its extraction directory or exceeds existing package limits
- **THEN** the response explains the error and creates no agent or session

#### Scenario: Retry after creation

- **WHEN** the same source and request are retried with the same Idempotency-Key
- **THEN** the completed creation is replayed rather than duplicated, without refetching the original source

#### Scenario: Conflicting request

- **WHEN** a caller reuses a key with a different source pin, message or connection choice
- **THEN** the API returns a conflict rather than silently replaying another request

#### Scenario: File changes after validation

- **WHEN** a mutable session-file zip changes after its validation pin was returned
- **THEN** load rejects the stale pin instead of accepting unvalidated replacement bytes

#### Scenario: Interrupted creation

- **WHEN** a request retries after partial creation
- **THEN** recovery uses its stored source pin and does not duplicate the workflow or session or substitute new bytes
