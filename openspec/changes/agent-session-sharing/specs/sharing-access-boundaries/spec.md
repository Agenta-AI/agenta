## ADDED Requirements

### Requirement: Resource policy step
`AccessService.decide` SHALL apply resource policy for `ResourceRef` kinds `agent` and `session` as step 4 of CONTRACT.md section 6, with the internal denial reason `resource_denied`. Every agent and session access SHALL use it, in routers, workers, channel tasks, and tool handlers. A private item that the caller may not read SHALL be answered as not found; an action the caller may not take on an item it can read SHALL be answered with `access_denied`.

#### Scenario: Viewer sends
- **WHEN** Carol, a Viewer, sends a turn in Alice's private session
- **THEN** the service answers `access_denied`, and Bob, who has no grant, gets not found for the same request

### Requirement: Resource policy is required
Every composition root that builds `AccessService` SHALL register the resource policy, and startup SHALL fail without it.

#### Scenario: Missing registration
- **WHEN** a worker entry point builds `AccessService` without a resource policy
- **THEN** the process fails at startup

### Requirement: Execution admission checks the session and the agent
Every point where a run starts or resumes SHALL check the existing session and the agent of the current turn through `decide`, before anything is invoked: the first heartbeat of each turn, queued dispatch, approval resume, a channel turn, trigger dispatch, and child invocation. A trigger SHALL resolve its current target before the check.

#### Scenario: Browser run into another member's private session
- **WHEN** Bob's browser run sends its first heartbeat for Alice's private session
- **THEN** the heartbeat is refused, the runner does not start the turn, and nothing is written

#### Scenario: Queued work
- **WHEN** a worker starts a queued turn after its principal lost access to the session or the agent
- **THEN** the worker does not start the turn and settles it failed

#### Scenario: Environment-bound trigger
- **WHEN** a schedule bound to an environment fires after the environment's agent became private to another member
- **THEN** the dispatcher checks the resolved agent, pauses the schedule, and creates no session

### Requirement: Admission checks the execution target of the turn
The checked agent SHALL be the revision that the turn runs, resolved at that point. The session's stored references and a trigger's stored `artifact_id` SHALL NOT be used as the authorization target. A run with no agent reference SHALL check only the session. A run whose agent reference resolves to nothing SHALL be denied.

#### Scenario: Turn target differs from the stored references
- **WHEN** a session's stored references name a project-visible agent, and Bob's browser turn runs Alice's private agent in that session
- **THEN** the first heartbeat checks Alice's private agent and is refused

#### Scenario: Unresolved agent reference
- **WHEN** a turn's first heartbeat carries a workflow reference that resolves to no agent in the project
- **THEN** the heartbeat is refused as not found and nothing is written

#### Scenario: Draft run
- **WHEN** a turn's first heartbeat carries no agent reference (no `workflow`, `application` or `environment` family key)
- **THEN** only the session is checked

### Requirement: Every heartbeat is authorized before it writes or answers
The heartbeat SHALL read the session row once, before any lock, row write or response, and SHALL authorize the beat from that row. A beat that finds no row SHALL check the agent of the turn. A beat for an existing row SHALL pass `RUN_SESSIONS` on the session, and the agent of the turn when it is running, through `decide`, unless it has verified continuity. A refused beat SHALL change no lock and no row, and SHALL return no session data.

#### Scenario: Concurrent create
- **WHEN** Bob's first heartbeat finds no row, and Alice's private session is created before Bob's insert
- **THEN** Bob's insert conflicts, the winning row is read and authorized for Bob before any lock, update or response, Bob is refused, and his next beat is refused too

#### Scenario: Refused beat writes nothing
- **WHEN** Bob's running heartbeat for Alice's private session is refused
- **THEN** no lock and no row changes, and the response carries no session data

### Requirement: Heartbeat creation resolves conflicts before liveness
A heartbeat that finds no row SHALL insert it before any liveness lock or admission record. When the insert conflicts, the heartbeat SHALL read the winning row and authorize it as an existing row before any lock, update or response.

#### Scenario: Concurrent create resolved first
- **WHEN** a rename creates Alice's private session between Bob's row read and his insert
- **THEN** Bob gets no lock, no update and no session data, and no admission record names Bob for that session

### Requirement: Steady heartbeats prove continuity
A beat has verified continuity only when it is running, its `turn_id` is the turn recorded on the row, and its credential's principal equals the principal recorded in Redis when that turn was admitted. Such a beat SHALL add no Postgres read and no access decision, and SHALL renew the record's TTL. Any other beat, and any beat whose record read fails, SHALL be fully authorized.

#### Scenario: Admission record unavailable
- **WHEN** the Redis read of the admission record fails
- **THEN** the beat is fully authorized; it never counts as continuous

#### Scenario: Later heartbeats of the admitted run
- **WHEN** the admitted run sends its second and later running heartbeats with the same credential
- **THEN** no access decision runs and no extra Postgres read is made

#### Scenario: Beat without a turn, or not running
- **WHEN** Bob sends a heartbeat for Alice's private session without a `turn_id`, or with `is_running` false
- **THEN** the heartbeat is refused as not found, and the row and the locks do not change

#### Scenario: Foreign credential with an admitted turn id
- **WHEN** Bob sends a running heartbeat that carries the `turn_id` of Alice's admitted turn with his own credential
- **THEN** the shortcut does not apply, the beat is checked for Bob, and it is refused

#### Scenario: Refusals look like an unknown item
- **WHEN** a heartbeat is refused because the session is private, or because its agent reference is unknown, archived, in another project or private
- **THEN** every refusal that hides the item has the same status and the same body

### Requirement: Policy reads are cached and invalidated by sharing writes
Agent and session policy reads SHALL go through a Redis cache with TTL `AGENTA_CACHE_TTL`, so a warm decision reads no Postgres row. An agent with no access row SHALL be cached as a tagged entry. Every sharing write and every session delete SHALL invalidate the affected entries after its commit. Sharing writes SHALL read the current policy from the database under the row lock, not from the cache.

#### Scenario: Warm decisions
- **WHEN** Bob sends three requests for the same session and agent
- **THEN** only the first reads the policy from Postgres

#### Scenario: Sharing change is seen at the next decision
- **WHEN** Alice makes her session private while Bob's entry for it is cached
- **THEN** Bob's next request for that session is answered as not found

### Requirement: Shortcuts do not open private items
The organization-owner, project-owner, and EE no-RBAC shortcuts SHALL NOT give access to a private agent or a private session.

#### Scenario: Organization owner and EE plan without RBAC
- **WHEN** the organization owner, or a member on an EE plan without RBAC, requests another member's private session
- **THEN** the service answers as if the session does not exist

### Requirement: List scopes match direct reads
List queries SHALL apply a read scope in SQL before ordering, counts, and pagination. Owner and grant eligibility SHALL come from the principal, never from a creator id. For every principal kind, a list SHALL contain exactly the items that a direct read allows.

#### Scenario: Parity for every principal kind
- **WHEN** Bob, an API key that Alice created, and an installation each list agents and sessions and then fetch each item by id
- **THEN** each list and count match what the direct fetches allow, and Alice's private items are in no list but Alice's

### Requirement: Private items lock when the owner leaves
A grant SHALL be valid only while the session owner is an active project member. A private item whose owner is not an active member SHALL be locked for everyone, admins included. A project-visible agent of a departed owner SHALL be ownerless. A project-visible session of a departed owner SHALL stay readable and SHALL accept no sends. Access SHALL return when the owner returns.

#### Scenario: Owner leaves
- **WHEN** Alice leaves the project
- **THEN** nobody can read her private items, members can still run her project-visible agent and read her project-visible session, and her Participant Bob cannot send
- **AND WHEN** Alice becomes a member again
- **THEN** the earlier access returns

### Requirement: Sharing writes are serialized and rechecked
Each sharing write SHALL lock the target row (the artifact row for an agent, also when no access row exists) and SHALL write only if the current policy equals the policy that the decision used. Session grant changes SHALL be applied as deltas. Generic updates and heartbeats SHALL NOT write access fields.

#### Scenario: Concurrent take-ownership
- **WHEN** two admins take ownership of the same ownerless agent at the same time
- **THEN** exactly one becomes the owner, and the other request is decided again on the new policy

#### Scenario: Transfer during make-private
- **WHEN** Alice transfers her agent to Carol while her make-private request waits on the lock
- **THEN** the make-private request writes nothing and is denied

#### Scenario: Concurrent invites
- **WHEN** Alice invites Bob and Carol in two requests at the same time
- **THEN** both grants exist

### Requirement: Sharing changes are audited
Each sharing change SHALL publish one event through the existing events stream with the resource, the policy before and after, the grant changes, the principal, the credential kind, and the request id. Events and denial logs SHALL NOT contain credential values. A failed publish SHALL NOT undo the change.

#### Scenario: Make private
- **WHEN** Alice makes her agent private
- **THEN** one `agents.sharing.changed` event records `project` before and `private` after, with Alice as the principal

### Requirement: Omitted visibility uses the owner default
From the first M3 release, an omitted visibility SHALL mean `private` when the ownership rule gives an owner, and `project` otherwise. `/w` SHALL create its chats through the rename create arm with `visibility=project` before it invokes, and SHALL send `visibility=project` when it creates an agent.

#### Scenario: New chat in /m
- **WHEN** Alice starts a web agent chat in `/m` without a visibility
- **THEN** the session is private and Alice owns it

#### Scenario: New chat in /w
- **WHEN** Alice starts a web agent chat in `/w`
- **THEN** the session is project-visible and Alice owns it
