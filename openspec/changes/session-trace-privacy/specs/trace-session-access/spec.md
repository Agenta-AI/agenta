# Trace session access delta

## Purpose

Let only the people who may read a session read its traces, also after deletion.

## ADDED Requirements

### Requirement: Span readability rule
A span SHALL be readable by a principal only if the principal passes `VIEW_SPANS` in the span's project and no span of the same trace carries a session id that names a session of that project, live or tombstoned, which the principal may not read. A trace with no such session id SHALL keep the `VIEW_SPANS` rule only.

#### Scenario: Private session of another user
- **WHEN** Bob has `VIEW_SPANS` and queries spans in a project where Alice has a private session
- **THEN** Bob SHALL NOT receive any span of that session's traces, root or child.

#### Scenario: Shared session
- **WHEN** Alice shares her session with Bob, then removes the share
- **THEN** Bob SHALL receive its spans only while the share exists.

#### Scenario: Trace without a session
- **WHEN** a playground run produces a trace with no session id
- **THEN** every `VIEW_SPANS` holder SHALL read it.

### Requirement: Privacy tombstone
Deleting a private session SHALL write a privacy tombstone with its id and owner in the same transaction. A tombstoned session SHALL be readable only by its former owner. The tombstone SHALL stay until the session's traces have expired under the trace retention.

#### Scenario: Deleted private session
- **WHEN** Alice deletes her private session and Bob, with `VIEW_SPANS`, queries the project's spans
- **THEN** Bob SHALL NOT receive any span of that session's traces.

#### Scenario: Deleted project-visible session
- **WHEN** a project-visible session is deleted
- **THEN** no tombstone SHALL be written and its traces SHALL keep the `VIEW_SPANS` rule.

### Requirement: Linkage
Every span that the platform emits for a session run SHALL carry the session id. Ingest SHALL keep the session id on every span that carries it and SHALL copy the root's session id to the children in the same batch.

#### Scenario: Children arrive first
- **WHEN** the child spans of a private session's trace are ingested before the root
- **THEN** they SHALL already be linked to the session and filtered.

### Requirement: Caller scope on every read
Every tracing service and DAO read SHALL take a required read scope built from the caller: the request principal for a route, the run authority for a run. Services that read traces for a user (saved queries, invocations, annotations, evaluations) SHALL pass the caller's scope.

#### Scenario: Saved query with traces
- **WHEN** Bob retrieves a saved query with `include_traces` and Alice has a private session
- **THEN** the traces and trace ids SHALL NOT include that session's traces.

#### Scenario: Agent and evaluation reads
- **WHEN** an agent run started by Bob calls `query_spans`, or Bob runs an evaluation over a trace query
- **THEN** only traces that Bob may read SHALL be returned.

#### Scenario: Sessions listing
- **WHEN** Bob lists trace sessions in a project
- **THEN** the list SHALL NOT contain Alice's private session.

### Requirement: Maintenance only and fail closed
An unrestricted scope SHALL exist only for a named maintenance operation. If a scope cannot be computed, the read SHALL fail with an error.

#### Scenario: Scope failure
- **WHEN** the core database is unavailable while a user queries spans
- **THEN** the request SHALL fail with an error status.
