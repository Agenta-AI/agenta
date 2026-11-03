# Access decision

## Purpose

Decide access from explicit inputs, in the fixed order of CONTRACT.md section 6, with no cached decision.

## ADDED Requirements

### Requirement: decide follows the fixed order
`decide` SHALL apply design D2 in order and return the first denial. The tenant SHALL come from the requested project.

#### Scenario: Deleted API key
- **WHEN** a run started by an API key continues after the key is deleted
- **THEN** the next decision SHALL deny with `principal_inactive`

#### Scenario: Run credential used for another project
- **WHEN** a run authority for project A is checked against project B
- **THEN** the decision SHALL deny with `restricted_by_authority`

#### Scenario: Human in two organizations
- **WHEN** a human in organizations X and Y is checked on a project of Y
- **THEN** the decision SHALL use the membership in Y only

#### Scenario: Agent restriction is unsupported in M2
- **WHEN** an authority carries a non-null `restrictions.agent`, whatever the resource, including no resource
- **THEN** the decision SHALL deny with `restricted_by_authority`

#### Scenario: API key whose creator is not a user
- **WHEN** an API key whose `created_by_id` has no `users` row is checked through `decide`
- **THEN** the decision SHALL deny with `principal_inactive`
- **AND** a request authenticated with that key SHALL fail in the auth middleware as it does today

### Requirement: decide accepts permissions and role requirements
`action` SHALL be a `Permission` or a `RoleRequirement`, evaluated for every principal kind.

#### Scenario: Legacy role check under a key
- **WHEN** a role check runs under an API key whose creator is admin
- **THEN** the decision SHALL allow

### Requirement: Installations keep today's authority
For `installation`, the capability step SHALL use the role user of design D3: the linked user when the Slack user is linked, else the binding creator. M2 SHALL NOT set installation restrictions.

#### Scenario: Unlinked Slack user uses the creator role
- **WHEN** an unlinked Slack user's run calls `query_spans` and the binding creator is a project admin
- **THEN** the decision SHALL allow

#### Scenario: Two Slack users on one binding
- **WHEN** an unlinked Slack user's `EDIT_WORKFLOWS` check is allowed for an admin binding creator, and then a linked viewer's run on the same binding checks `EDIT_WORKFLOWS`
- **THEN** the decision SHALL deny with `missing_capability`

### Requirement: check_action_access uses the request principal only
`check_action_access` SHALL keep its signature and SHALL decide with the request's `RequestAccess`. With no request access, or with a `user_uid` that is not the request's acting user, it SHALL raise and SHALL NOT check `human(user_uid)`. A check about another human SHALL use `AccessService.check_human`.

#### Scenario: Handler under a run credential
- **WHEN** a handler calls `check_action_access(request.state.user_id, ...)` under an installation run credential
- **THEN** `decide` SHALL receive the installation principal and its authority

#### Scenario: Check for another user without the explicit helper
- **WHEN** code calls `check_action_access` with a user id that is not the request's acting user
- **THEN** the call SHALL raise `RequestAccessMismatch`

### Requirement: No cache stores a decision
No cache SHALL store the result of a decision. `decide` SHALL run on every call. The principal record cache SHALL be invalidated on key deletion, binding and connection changes and user deletion. The credential exchange SHALL decide before it mints and SHALL mint nothing on deny.

#### Scenario: Key deleted with warm caches
- **WHEN** an API key's run credential refreshes through the exchange after the key is deleted, with warm middleware and principal caches
- **THEN** the exchange SHALL deny and SHALL NOT mint a token

#### Scenario: Member removed with warm caches
- **WHEN** a member is removed from a project and their next checked request arrives with a warm middleware cache
- **THEN** the decision SHALL deny with `not_member`

### Requirement: Membership is cached, including its absence
Membership SHALL be read through the `resolve_membership` cache, keyed per user and project with TTL `AGENTA_CACHE_TTL`. The cache SHALL store the absence of a membership as a tagged entry, with the same key, TTL and invalidation as a membership. Every M1 membership mutation SHALL invalidate that cache for the affected users and projects. A read that started before a mutation committed MAY refill the old entry after the invalidation; that entry SHALL live no longer than `AGENTA_CACHE_TTL`.

#### Scenario: Repeated denied requests read Redis, not Postgres
- **WHEN** a user who is not a member of a project sends three checked requests for that project
- **THEN** each decision SHALL deny with `not_member`
- **AND** only the first decision SHALL read membership from Postgres; the others SHALL read the cached absence from Redis

#### Scenario: A new member is seen after a cached absence
- **WHEN** a user's absence is cached for a project, and an M1 mutation then adds the user to the project
- **THEN** the next decision for that user and project SHALL use the new membership

#### Scenario: Membership removal is seen by the next decision with a warm membership cache
- **WHEN** a member's `resolve_membership` entry for a project is cached, and the member is then removed from that project
- **THEN** the next decision for that member and project SHALL deny with `not_member`
- **AND** it SHALL NOT use the cached membership

### Requirement: Credential exchanges without a permission check principal eligibility
`POST /gateways/credentials` SHALL run `check_eligibility` before it mints.

#### Scenario: Gateway credential for a deleted key
- **WHEN** a run credential of a deleted API key asks for a gateway credential
- **THEN** the route SHALL answer 403 `access_denied` and SHALL NOT mint

### Requirement: Denials are logged without credentials
Every deny SHALL write one log line with principal kind and id, role user, credential kind, organization, project, action, resource, reason and run correlation, and SHALL NOT include token values, raw claims or secrets.

#### Scenario: Denied request
- **WHEN** a decision denies
- **THEN** the log line SHALL name the principal and the reason and SHALL NOT contain the credential
