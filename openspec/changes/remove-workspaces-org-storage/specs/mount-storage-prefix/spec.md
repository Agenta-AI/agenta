# Mount storage prefix delta

## ADDED Requirements

### Requirement: Mount storage follows the contract layout
Mount storage SHALL follow CONTRACT.md section 9. The stored `storage_prefix` SHALL exclude the deployment namespace and the trailing slash. Agenta SHALL set it once, when the row is created, and SHALL NOT change it afterwards. The insert that creates a mount SHALL write its id and its prefix.

#### Scenario: Existing mount after the backfill
- **WHEN** the migration runs on a mount created before this change in project P with id M
- **THEN** the row SHALL store `mounts/P/M`, and no object in the bucket SHALL move.

#### Scenario: New agent mount
- **WHEN** an agent in project P of organization O gets its first mount after the M4b mount step
- **THEN** the row SHALL store `mounts/O/<mount_id>`, and the first file write SHALL land under that prefix.

#### Scenario: Re-binding an existing session mount
- **WHEN** a session mount is requested again for the same session and name
- **THEN** the service SHALL return the existing row with its stored prefix.

#### Scenario: Credentials cover only the stored prefix
- **WHEN** a run asks for credentials for a mount that stores `mounts/O/M`
- **THEN** the credentials SHALL allow `mounts/O/M/*` and SHALL deny `mounts/O/<other>/*` and `mounts/<project_id>/M/*`.

### Requirement: One code path builds every mount key
Every file operation and every STS signing SHALL build the object key from the deployment namespace (when set) and the row's `storage_prefix`. No code SHALL compute a mount key from a project id.

#### Scenario: Namespaced deployment
- **WHEN** the namespace is `pr-123` and a mount stores `mounts/O/M`
- **THEN** a read of `notes.md` SHALL use the key `pr-123/mounts/O/M/notes.md`.

### Requirement: A per-mount predicate tells whether a mount is organization-keyed
With the M4b mount step, core SHALL provide `is_organization_keyed(mount, organization_id)`. It SHALL return true exactly when the stored prefix equals `mounts/<organization_id>/<mount_id>`.

#### Scenario: Old mount
- **WHEN** the predicate runs on a mount that stores `mounts/P/M`
- **THEN** it SHALL return false.

#### Scenario: New mount
- **WHEN** the predicate runs on a mount that stores `mounts/O/M` with organization O
- **THEN** it SHALL return true.

#### Scenario: Malformed prefix
- **WHEN** the predicate runs on a mount that stores `mounts/O/M/extra`
- **THEN** it SHALL return false.

### Requirement: Mount rollout is safe with old pods
The prefix SHALL ship as design.md D4 describes. In M4a, every new row SHALL store the project layout, and a re-bind on a previous-release pod SHALL succeed and keep the stored prefix. In the M4b mount step, pods of M4a SHALL serve organization-keyed mounts.

#### Scenario: Mount created by a previous-release pod during the M4a rollout
- **WHEN** a pod from before M4a creates a mount during the M4a rollout
- **THEN** the row SHALL store `mounts/<project_id>/<mount_id>`, which is the key that pod computes.

#### Scenario: Re-bind on a previous-release pod during the M4a rollout
- **WHEN** a pod from before M4a re-binds an existing mount during the M4a rollout
- **THEN** the request SHALL succeed and the row SHALL keep its stored prefix.

#### Scenario: An M4a pod during the M4b mount step rollout
- **WHEN** an M4a pod reads a mount that stores `mounts/O/M`
- **THEN** it SHALL use the stored prefix for every key and credential.

### Requirement: Response shape
No API response SHALL include `storage_prefix`.

#### Scenario: Mount responses
- **WHEN** a client creates, fetches, queries or signs a mount
- **THEN** no mount object in the response SHALL have a `storage_prefix` field, and the OpenAPI schema SHALL declare no such property.
