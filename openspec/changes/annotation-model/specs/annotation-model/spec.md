## ADDED Requirements

### Requirement: One general annotation schema for every evaluator

The platform SHALL write every annotation that `POST /annotations` or `POST /simple/traces` creates as a span in its own trace with the general fields `ag.session.id`, `ag.turn.id`, `ag.annotation.scope`, `ag.annotation.author`, `ag.annotation.actor`, links with a role per link, and the working agent in the references, for every evaluator.

Decided by the founder on 16 November 2026. His word on the draft schema: "lgtm". His words: "the soution needs to be general".

#### Scenario: A score from any evaluator gets the general fields

- **WHEN** a person scores span `sp-91` of trace `T-b` with the evaluator `correctness` through `POST /simple/traces`
- **THEN** the stored annotation span carries `ag.annotation.scope`, `ag.annotation.author` and `ag.annotation.actor`
- **AND** it carries the subject's `ag.session.id` and `ag.turn.id` when the subject span has them
- **AND** `ag.data.outputs` holds only the evaluator's output, as today

#### Scenario: An annotation with no run as its subject

- **WHEN** a person annotates a testcase in an annotation queue and the request has `links: {}`
- **THEN** the platform stores the annotation with no scope, no subject link, no session and no turn, and with `ag.annotation.author` and `ag.annotation.actor`
- **AND** every response gives the same fields as today

### Requirement: The subject's session and turn on the annotation

The platform SHALL set `ag.session.id` and `ag.turn.id` of an annotation to the session and turn of its subject, copied from the stored subject span, and ingest SHALL copy them into the `session_id` and `turn_id` columns of the annotation's row (Decided). The detailed rules below are Proposed.

#### Scenario: The subject span is stored

- **WHEN** an annotation links to span `sp-91`, whose row has `session_id: s-40` and `turn_id: t2`
- **THEN** the annotation has `ag.session.id: s-40` and `ag.turn.id: t2`, and its row has the columns `session_id: s-40` and `turn_id: t2`

#### Scenario: The request names another session

- **WHEN** the request gives `session_id: s-41` and links to span `sp-91`, whose stored row has session `s-40`
- **THEN** the annotation has `ag.session.id: s-40`, copied from the stored span, and the request is not refused

#### Scenario: The subject span is not stored yet

- **WHEN** a request links to a span that ingest has not stored yet, and gives `session_id` and `turn_id`
- **THEN** the platform stores the annotation with the given session and turn, unchecked

#### Scenario: The agent annotates its own running span

- **WHEN** the agent tool `annotate_trace` annotates the agent's own running span of turn `t2` of session `s-40`, which ingest has not stored yet, and the request gives no session and no turn
- **THEN** the platform reads the turn row that names the span's trace and stores the annotation with `ag.session.id: s-40` and `ag.turn.id: t2`

#### Scenario: The annotation's own trace is not part of the session

- **WHEN** a reader filters spans by `session_id: s-40`
- **THEN** the annotation rows in the result mean "about s-40", and their own trace is not a run of s-40

### Requirement: The scope of an annotation

The platform SHALL store `ag.annotation.scope` with one of `span`, `trace`, `turn` or `session` on every annotation that has a subject or a given scope, SHALL default it to `span` when the request gives a link and no scope, SHALL refuse any other value with 422, and SHALL refuse no combination of scope, link, session and turn (Decided).

#### Scenario: An old client sends no scope

- **WHEN** the web app sends `links: {invocation: {trace_id: T-b, span_id: sp-91}}` and no scope
- **THEN** the annotation has `ag.annotation.scope: span`

#### Scenario: Trace scope keeps the caller's link

- **WHEN** a request gives `scope: trace` and links to a child span of trace `T-b`
- **THEN** the platform stores the link as the caller gave it

#### Scenario: A scope that does not fit the request

- **WHEN** a request gives `scope: turn` and no link, no session and no turn
- **THEN** the platform stores the annotation with `ag.annotation.scope: turn` and refuses nothing

### Requirement: Every annotation about a run links to a span

The platform SHALL give every annotation that has a scope one subject link to a span when a span is known, at every scope (Decided, Option A). The link only anchors the annotation in a session and in time; nothing depends on which exact span it is (Decided).

#### Scenario: A turn annotation without a span

- **WHEN** a request gives `scope: turn`, `session_id: s-40`, `turn_id: t2` and `links: []`
- **THEN** the platform links the annotation with the role `subject` to the span that the row of turn `t2` names, and reads nothing else

#### Scenario: A session annotation and a later turn

- **WHEN** a person writes a note on session `s-40` after turn `t2`, and the session later gets turn `t3`
- **THEN** the subject link points to the span that the row of turn `t2` names, and the annotation has no `ag.turn.id`
- **AND** turn `t3` does not change the annotation

#### Scenario: No turn row

- **WHEN** a request gives `scope: session` and `session_id: s-99`, and session `s-99` has no turn row
- **THEN** the platform stores the annotation with `session_id: s-99` and no subject link

#### Scenario: A turn row that names no span

- **WHEN** the row of turn `t2` has no trace id and no span id
- **THEN** the platform stores the annotation with `session_id: s-40` and `turn_id: t2` and no subject link

#### Scenario: An old client's role stays

- **WHEN** an old client sends one link with the role `invocation`
- **THEN** the platform keeps the role `invocation` and uses that link as the subject

#### Scenario: Several links and none is the subject

- **WHEN** a request sends two links with the roles `evidence` and `invocation`, in that order, and none with the role `subject`
- **THEN** the platform uses the first link as the subject

His words on Option A: "I think you should always link to a span, just because it's kind of the point in time where you're providing feedback for the session. Don't forget that the session can continue after the feedback, so the feedback is always temporal to the last span in which this feedback has been done. I would go with option A."

His words on the span to link: "aren't we supposed to use this as a way to capture raw data? so that the agent later finds it and leverage it is needed. why do we care so much which exact span is annotated. i think the simplest solution to implement is the onw we should use"

### Requirement: The author is set by the platform

The platform SHALL set `ag.annotation.author` from the request's credential as `{type: person, user_id}` for every user credential and SHALL take no author from the request body (Decided). The types are `person`, `end_user`, `agent_run` and `platform`; this change writes only `person`.

#### Scenario: A person writes through the web app

- **WHEN** user `u-3` creates an annotation in the web app
- **THEN** `ag.annotation.author` is `{type: person, user_id: u-3}`

#### Scenario: A request tries to set the author

- **WHEN** a request body holds `author: {type: platform}`
- **THEN** the platform ignores it and sets the author from the credential

### Requirement: The actor says who acted

The platform SHALL store `ag.annotation.actor` as `{type, user_id}` and, in this change, SHALL set it equal to the author; the request has no actor field (Decided, simplification 5).

#### Scenario: A script records a thumbs down

- **WHEN** a script with an API key of user `u-5` creates an annotation
- **THEN** the annotation has `author: {type: person, user_id: u-5}` and `actor: {type: person, user_id: u-5}`

#### Scenario: A request tries to set the actor

- **WHEN** a request body holds `actor: {type: end_user}`
- **THEN** the platform ignores it, and the actor equals the author

### Requirement: Links as a list with a role per link

The platform SHALL accept links as a list in which each item carries its role in `attributes.key`, SHALL store each role as given, SHALL keep the role `"key"` for a list item with no role as today, SHALL keep accepting a map from role to link, and SHALL keep the map shape of `links` in the responses of the annotation routes (Proposed).

#### Scenario: Two links share a role

- **WHEN** a request sends links `[{trace_id: A-0, span_id: s0, attributes: {key: evidence}}, {trace_id: A-9, span_id: s9, attributes: {key: evidence}}, {trace_id: T-b, span_id: sp-91, attributes: {key: subject}}]`
- **THEN** the stored annotation has three links with the roles `evidence`, `evidence` and `subject`
- **AND** `POST /spans/query` returns all three links

#### Scenario: The read shape of the annotation routes

- **WHEN** a client reads any annotation through `GET /annotations/{id}`, `GET /simple/traces/{id}` or the query routes of the annotation routes
- **THEN** the response gives `links` as a map from role to link, as today

#### Scenario: The create response

- **WHEN** a client creates an annotation through `POST /annotations` or `POST /simple/traces`
- **THEN** the response gives `links` exactly as the request sent them, as today, also when they are a list
- **AND** the response has no new field; a reader gets the session, turn, scope, author and actor through `POST /spans/query`

### Requirement: The working agent only in the references

The platform SHALL name the working agent and its revision only in the references `application`, `application_variant` and `application_revision`, and SHALL copy them from the root span of the subject's trace when the request gives none (Decided as a place; the copy is Proposed).

His words: "Agent is a reference. It's an application. As a reference, we already have that."

#### Scenario: The run carries workflow references

- **WHEN** the root span of the subject's trace carries `workflow` and `workflow_revision` references, as runs started by the session start path do today
- **THEN** the annotation gets `application` and `application_revision` references with the same ids (Decided, his word: "ok")

### Requirement: Edits keep the general fields

The platform SHALL keep `ag.session.id`, `ag.turn.id`, `ag.annotation.scope`, `ag.annotation.author` and `ag.annotation.actor` when a person edits an annotation, SHALL keep the stored `application*` references when the edit names none, and SHALL treat the links of an edit as today.

#### Scenario: A person edits a score

- **WHEN** user `u-3` changes the score of an annotation of scope `turn` about turn `t2`
- **THEN** the edited annotation still has scope `turn`, `ag.turn.id: t2` and the same author
- **AND** it keeps the subject link, because the web app sends back the links it read

### Requirement: Ingest keeps the annotation namespace

Ingest SHALL keep attributes under `ag.annotation` in place and SHALL NOT move them to `ag.unsupported` (Proposed).

#### Scenario: An annotation is stored

- **WHEN** ingest reads an annotation span with `ag.annotation.scope: turn`
- **THEN** the stored attributes hold `ag.annotation.scope: turn`

### Requirement: Queries on the general fields

The platform SHALL answer "all annotations about one session", "about one turn", "of one scope", "by one actor" and "linked to one span with one role" with one `POST /spans/query` each, on the `session_id` and `turn_id` columns, the attribute paths under `ag.annotation`, and the `links` column (Proposed).

#### Scenario: All feedback of a session

- **WHEN** a caller filters on `session_id: s-40` and on `ag.annotation` existing
- **THEN** the platform returns every annotation about `s-40` at every scope, and no run span

#### Scenario: Notes on whole sessions of one working agent

- **WHEN** a caller filters on the reference id of the working agent and on `ag.annotation.scope: session`
- **THEN** the platform returns the session notes of that working agent

#### Scenario: Annotations linked with one role

- **WHEN** a caller filters `links` with `[{trace_id: A-1, "attributes.key": evidence}]`
- **THEN** the platform returns the annotations that cite `A-1` as evidence

### Requirement: Annotations have their own retention

The paid edition SHALL NOT delete an annotation record with the trace window of the plan, and SHALL keep it after the traces that it links to are deleted (Decided, his word: "agree"). The flush SHALL skip a trace whose root span has `ag.annotation`, and annotation records SHALL stay until the project is deleted (Decided, his word: "ok").

#### Scenario: The trace window passes

- **WHEN** the flush deletes the traces of session `s-40` that are older than the plan window
- **THEN** the annotations about `s-40` that have `ag.annotation` stay

#### Scenario: The subject span is gone

- **WHEN** retention has deleted the span that an annotation's subject link points to
- **THEN** the link points to a missing span, and readers treat that as normal
- **AND** a filter on `session_id` or `turn_id` still finds the annotation

#### Scenario: Evaluator traces keep the trace window

- **WHEN** the flush meets an evaluator trace that arrived through OTLP
- **THEN** it deletes it with the trace window, as today, because it is not an annotation record

#### Scenario: Old annotations

- **WHEN** the flush meets an old annotation with no `ag.annotation`
- **THEN** it deletes it with the trace window, as today

### Requirement: Session and turn rows stay while annotations name them

The platform SHALL keep a session row and its turn rows while any annotation names the session, and SHALL NOT delete them by any time-based job (Decided, his word: "agree"). When a person deletes a session by hand, the delete SHALL go ahead and the annotations SHALL stay with their ids (Decided).

#### Scenario: Time passes

- **WHEN** the trace window deletes all spans of session `s-40`, and annotations name `s-40`
- **THEN** the session row of `s-40` and its turn rows stay

#### Scenario: A person deletes the session

- **WHEN** a person deletes session `s-40`, which annotations name
- **THEN** the delete goes ahead, and the annotations stay with `session_id: s-40` and their turn ids

His words: "ok, we just need to think later when we build the tools to retrieve this information on how to inform the agent about this". Telling the learner that a session or a turn was deleted belongs to the retrieval tools of a later change.

### Requirement: Existing evaluation and annotation flows keep working unchanged

The platform SHALL store and read back every field that exists today with the same value, SHALL refuse no request that uses none of the new fields for a reason that does not exist today, and SHALL leave evaluator traces that arrive through OTLP as they are today.

His words: "let's just make sure we dont break evals and annotations for prompts/evaluators, etc..".

#### Scenario: Human annotation in the web app

- **WHEN** a person scores a span in the trace drawer, and the web app sends `links: {invocation: ...}`, `origin: human`, `kind: adhoc`, `channel: web`
- **THEN** the response and every later read give the same `origin`, `kind`, `channel`, `data`, `references` and map of `links` as today
- **AND** the web app shows and edits the annotation as today

#### Scenario: Human annotation in an evaluation run or a queue

- **WHEN** a reviewer annotates an evaluation result, and the link role is an evaluation step key
- **THEN** the platform keeps that role and stores and reads the annotation as today, with the new fields added

#### Scenario: Automatic evaluator results in an evaluation

- **WHEN** the SDK runs an automatic evaluator in an evaluation and sends its trace through OTLP with links `invocation`
- **THEN** ingest stores the trace as today, and the trace flush deletes it with the trace window as today

#### Scenario: Annotation on a prompt trace

- **WHEN** a person annotates a span of a prompt run that has no session and no turn
- **THEN** the annotation has no `ag.session.id` and no `ag.turn.id`, and every field of today keeps its value

#### Scenario: Testcase annotation with no link

- **WHEN** an annotation queue sends a testcase annotation with `links: {}`
- **THEN** the platform reads it back exactly as today, and stores only the author and the actor in addition

#### Scenario: An SDK call

- **WHEN** a script or the agent tool `annotate_trace` sends `POST /annotations` with a map of links and data that matches the evaluator schema
- **THEN** the platform accepts it as today, also when the linked span is not stored yet

#### Scenario: An old client sends a list of links without roles

- **WHEN** a client sends `links` as a list whose items carry no role
- **THEN** the platform stores each link with the role `"key"`, as today

### Requirement: Old annotations and old clients keep working

The platform SHALL read old annotations unchanged, SHALL accept requests that carry none of the new fields, and SHALL NOT backfill old annotations.

His words: "We definitely do not care about old traces and old data, right?"

#### Scenario: An old annotation is read

- **WHEN** a client reads an annotation written before the change
- **THEN** the response has the same fields as today and no scope, author or actor

#### Scenario: An old request is sent

- **WHEN** an old client sends a map of links with one role and no new field
- **THEN** the platform stores the annotation with scope `span`, the author, the actor equal to the author, and the subject's session and turn when the subject span is stored
