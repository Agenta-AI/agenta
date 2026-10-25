## ADDED Requirements

### Requirement: Session roles
A web agent session SHALL have a visibility, an optional owner, and named Viewer or Participant grants. The owner SHALL read, send, answer approvals, change sharing, rename, archive, and delete. A Participant SHALL read, send, and answer approvals. A Viewer SHALL read.

#### Scenario: Viewer
- **WHEN** Carol has Viewer access to Alice's private session
- **THEN** Carol can read the session and cannot send, answer an approval, rename, or change sharing

### Requirement: Capabilities and agent access still apply
Every role SHALL also require the project capability for the action. A send SHALL require agent access for the sender's own authority. Reading history SHALL NOT require agent access. Humans SHALL only read a channel session in Agenta.

#### Scenario: Participant sends under his own authority
- **WHEN** Bob, a Participant, sends a turn in Alice's session after he lost access to the agent
- **THEN** his turn is refused, and he can still read the history

### Requirement: Project visibility gives Participant
Project visibility SHALL give Participant access to members with the project capability in a web session, owned or ownerless, also after the owner left: they read, send and answer approvals. It SHALL take precedence over a Viewer grant. Rename, archive, delete and sharing changes SHALL stay with the owner. An ownerless session SHALL keep today's rename, archive and delete rule: any principal with `EDIT_SESSIONS`. A channel (Slack) session SHALL keep Viewer access for people.

#### Scenario: Ownerless session
- **WHEN** a member opens a project-visible session that an API key started
- **THEN** the member can read it and send to it under his own authority, and the API key can still send to it

#### Scenario: Project-visible session of a colleague
- **WHEN** Bob opens Alice's project-visible session, and later Alice leaves the project
- **THEN** Bob can send and answer its approvals before and after Alice left, and only Alice can rename, archive, delete it or change its sharing

#### Scenario: Legacy sessions after the backfill
- **WHEN** a member opens a backfilled session that has no owner (an empty session with no creator, or a session whose only turn is a child run of a person), or a backfilled chat whose first sender is its owner and the member sent its second turn
- **THEN** the member can send to it and answer its approvals, and only the owner, when there is one, can rename, archive or delete it

#### Scenario: Channel session
- **WHEN** a member opens a project-visible session that comes from Slack
- **THEN** the member can read it and cannot send to it in Agenta

### Requirement: A person's server run runs in its ownerless session
A person's server run (an event subscription, a child run, an evaluation run) SHALL run in an ownerless session, like any non-human principal: its signed run origin, not the person sending, decides. A turn admitted for such a run SHALL NOT admit the same person's web or browser requests.

#### Scenario: A person's subscription runs in its ownerless session
- **WHEN** an event subscription that Alice created fires, and its run (Alice's principal, origin subscription) beats and writes in the ownerless session it claimed
- **THEN** every beat, write and next turn of that run is admitted

### Requirement: Every session insertion path sets the initial policy
Turn start, rename before the first turn, trigger claim, and first-heartbeat creation SHALL insert the row with a policy that `SharingService.initial_policy` computed on the server. The rename create arm SHALL accept an optional requested visibility. No conflict arm SHALL change the access fields.

#### Scenario: Schedule sessions
- **WHEN** a schedule of Alice fires, and a schedule of an API key fires
- **THEN** Alice owns the first session, the second is project-visible with no owner, and later heartbeats change neither

#### Scenario: Heartbeat creates the row first
- **WHEN** the first heartbeat of a run that Alice started in a browser session inserts the session row
- **THEN** Alice is the owner and the session is private

#### Scenario: Rename before the first turn
- **WHEN** Alice names a session before its first turn, once without a visibility and once with `visibility=project`
- **THEN** Alice owns both, the first is private and the second is project-visible

### Requirement: Manage session sharing
Only the owner SHALL change visibility and grants. Grants SHALL name active members of the same project, one per user, and the service SHALL reject other users. The invite field SHALL list project members from the M1 membership resolver, never from workspace members. "Only me" SHALL set `private` and remove every grant in one transaction.

#### Scenario: Removed member
- **WHEN** Bob loses his grant or his membership
- **THEN** his next read, send, or stream subscription is denied

#### Scenario: Member picker in EE
- **WHEN** Alice opens the invite field in an EE project that has some organization members as project members
- **THEN** the field lists only the project members

### Requirement: Approvals in a shared session
Only the owner or a Participant (a member of a project-visible web session included) SHALL answer an approval in Agenta. Before the resumed action runs, the system SHALL check the session and the agent again for the original authority (CONTRACT.md section 3).

#### Scenario: Participant approves
- **WHEN** Bob, a Participant, approves Alice's waiting turn
- **THEN** the action runs under Alice's authority and Bob is recorded as `approved_by`, or the run stops if Alice lost access to the agent

### Requirement: Share step disclosure
Before an owner widens who can see a session or makes an agent project-visible, the system SHALL show the agent's connected accounts and SHALL state that the people added will see everything in the session. The user documentation SHALL state that project members who can read traces can read the session. Trace storage, queries, and permissions SHALL NOT change.

#### Scenario: Shared session disclosure
- **WHEN** Alice invites Bob to a session whose agent uses a Gmail connection
- **THEN** before the invite is saved she sees one sentence that names the connected accounts and says that Bob will see everything in the session

#### Scenario: Disclosure flags in the API
- **WHEN** a client reads a session's sharing state
- **THEN** the response carries the connections and the three disclosure flags (run credentials, files and tool results, trace readers), and the UI leaves out the trace readers statement

### Requirement: Session files follow the session
Session file reads, downloads, exports, and storage credentials SHALL require read access to the session. Unexpired credentials SHALL NOT be recalled, and the documentation SHALL say so.

#### Scenario: Access removed
- **WHEN** Bob's access is removed after he received a storage credential
- **THEN** his next credential request is denied and the earlier credential works until it expires

### Requirement: Existing chats after migration
Only rows written by pre-M3 code SHALL be backfilled. They SHALL become project-visible. The owner SHALL follow the CONTRACT.md section 7 rule applied to the first turn's recorded principal, origin and sender when the turn has them, else the recorded creator. Channel sessions SHALL have no owner. A row that new code wrote SHALL NOT be changed by the backfill, also when it has no owner.

#### Scenario: Old chats
- **WHEN** the migration runs on a chat that Carol started, on a row with no creator, and on a chat whose first turn an API key sent after M2
- **THEN** all three are project-visible, Carol owns the first, and the second and third have no owner

#### Scenario: New ownerless row
- **WHEN** an API key starts a session on the new release and the backfill logic runs again
- **THEN** the session keeps no owner

#### Scenario: Chat created by an old pod during the deploy
- **WHEN** a pod of the previous release creates Alice's chat during the rolling deploy
- **THEN** the chat is listed as project-visible, and the first direct access assigns Alice as its owner
