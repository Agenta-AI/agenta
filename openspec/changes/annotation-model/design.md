## Context

### Words used here

- A **span** is one recorded step of a run, such as a model call or a tool call. The span is the only OpenTelemetry entity. A **trace** is the tree of spans that one run makes. Trace id, span id, session id and turn id are indexes on a span.
- A **session** is one conversation or one piece of work with an agent, made of ordered **turns**. A turn is one exchange: one input, until the run stops or waits for a person. Spans of different traces can carry the same turn id, for example after a person approves a paused tool call and the run resumes.
- An **annotation** is a stored judgment about a run: a score, a label, a comment or a correction. In Agenta an annotation is itself a span, alone in its own trace, in the same `spans` table as the runs.
- An **evaluator** is the definition that an annotation names. It says what the values of the annotation look like (a JSON Schema of its outputs).
- A **link** is a pointer from one span to another span, made of a trace id, a span id and a **role** (stored as the link attribute `key`), such as `invocation` or `subject`.
- A **reference** names another entity (an evaluator, an application, a testset) by `id`, `slug` and `version`, with a role such as `evaluator` or `application_revision`.
- The **subject** of an annotation is what it judges. The **scope** says how much of the run the subject is: one span, one trace, one turn or one session.
- The **author** of an annotation is whoever wrote the record. The **actor** is whoever made the judgment or did the act that the record describes. They differ when platform code records what a person did.
- **Retention** is the rule that deletes old data. Agenta's paid edition deletes old traces on a schedule.
- **An annotation record** is what the two annotation routes write (`POST /annotations`, `POST /simple/traces`). From this change on, every annotation record carries `ag.annotation` (at least the author and the actor). An **evaluator trace** is a trace that an automatic evaluator sends through OTLP; ingest also marks it as trace type `annotation`, but it is not an annotation record and carries no `ag.annotation`. "Annotation" in the rules below means an annotation record.
- **Turn id** means the id of a session turn: the column `turn_id` of the turn row, which the change `sessions-and-spans` also writes as `ag.turn.id` and the span column `turn_id` on every span of the turn. It is never the turn row's own key `id`. The request field `turn_id` and the span query field `turn_id` use this meaning.
- **Layer 1** is the general annotation schema that every annotation of every evaluator has. **Layer 2** is the output of one evaluator, under `ag.data.outputs`.

All facts below were read at `origin/main`, commit `8d6f0dff68` (13 November 2026). Each fact cites the file and lines. The citations were checked again against that commit before the implementation; the corrections are listed in "Corrections after the citation check" at the end.

**Five simplifications agreed by the founder after his review** (16 November 2026), applied in this version:

1. At trace scope the platform stores the link as the caller gave it. It does not move the link to the root span of the trace.
2. The platform checks only that the scope is one of the four values. No combination of scope, link, session or turn is refused.
3. The answers of the annotation routes get no new fields. Readers find the new fields through `POST /spans/query`.
4. At session scope the turn stays empty. The platform does not set it to the latest turn.
5. The request has no field for who acted. In this change the actor always equals the author. A request field for the actor comes later with the learner tools.

### How annotations work today

**An annotation is a one-span trace.** The annotation service makes a new trace id and span id, sets the span type `task`, and names the span after the evaluator slug (`api/oss/src/core/annotations/service.py:557-560`). It writes the span through the same path as any trace (`api/oss/src/core/tracing/service.py:318-336`). The id of an annotation is its trace id.

**Two routes write annotations, and they check different things.**

| | `POST /annotations` | `POST /simple/traces` |
|---|---|---|
| Route and service | `api/oss/src/apis/fastapi/annotations/router.py:45-54, 102-129`; `api/oss/src/core/annotations/service.py:74-241` | `api/oss/src/core/tracing/service.py:1170-1241` |
| Who calls it | the agent tool `annotate_trace` (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:1983-1995`), outside scripts | the web app for every create, edit and delete (`web/packages/agenta-entities/src/annotation/api/api.ts:70-83`) |
| Evaluator schema check | the whole `data` object against the revision's `schemas.outputs`; a mismatch answers 422 (`annotations/service.py:155-160`, `annotations/utils.py:33-57`) | none |
| Unknown evaluator slug | creates a human evaluator with a schema inferred from the first sample by the `genson` library (`annotations/service.py:105-132`) | the same (`tracing/service.py:1099-1127`), but only when the request has links (`tracing/service.py:1086`) |

Both routes take the same input model. (`POST /invocations` extends the same model; after this change it extends a base model without the three new fields, so the invocation request does not change.) `AnnotationCreate` is `SimpleTraceCreate` (`api/oss/src/core/annotations/types.py:48-49`), with `origin`, `kind`, `channel`, `tags`, `meta`, `data`, `references` and `links` (`api/oss/src/core/tracing/dtos.py:339-350`). The input has no time field, no session, no turn, no scope, no author and no actor.

**Links.** The input `links` is either a map from role to link or a list of links (`dtos.py:322`). A link item is the OpenTelemetry link model with an optional `attributes` field (`api/oss/src/core/shared/dtos.py:42-45`, `sdks/python/agenta/sdk/models/tracing.py:154-159`). The service turns a map into stored links whose `key` is the map key, and a list into stored links whose `key` is always the literal `"key"`, whatever the item's own attributes say (`api/oss/src/core/tracing/utils/traces.py:60-83`, the list case at 72-81). On read, the service turns the stored links back into a map keyed by role (`traces.py:124-132`), so two links with the same role collapse into one. The database keeps links flattened: a stored link is `{"trace_id": ..., "span_id": ..., "attributes.key": "invocation"}` (`api/oss/src/dbs/postgres/tracing/mappings.py:186-193` with `api/oss/src/core/tracing/utils/attributes.py:360-384`). Ingest turns link ids into the UUID form (`api/oss/src/core/tracing/utils/parsing.py:278-281`).

**References.** The input has fixed keys: query, testset, application, evaluator and environment, each at artifact, variant and revision level, plus `testcase` (`dtos.py:302-319`). It has no `workflow` key, although ingest keeps `workflow` references on other spans (`attributes.py:25-48`). In the attributes, references sit in a map keyed by role, `ag.references.<role>` (`attributes.py:212-227`). Ingest also stores them in the `references` column as a list, each entry with its role in the attribute `key` (`parsing.py:325-349`).

**Who wrote an annotation.** Three fields exist, and none says who acted:

- `origin` (`human`, `custom`, `auto`) and `channel` (`api`, `web`, `sdk`, `otlp`) are stored as flags under `ag.flags` (`dtos.py:283-299`; `tracing/service.py:1007-1024`). On `POST /simple/traces`, `origin: auto` writes no flag, and the read turns "no `is_feedback` flag" into `custom` (`tracing/service.py:1026-1048`, the default at 1031-1035). So `auto` reads back as `custom`. On `POST /annotations`, the same value reads back as `auto`, because that path writes `is_custom: false` and `is_feedback: false` and its read has a third branch (`annotations/service.py:162-169, 626-636`). The two routes disagree.
- `created_by_id` is the user of the request (`router.py:119`), written on the row at the database write (`mappings.py:209-210`).
- The `user_id` column comes from `ag.user.id` on root spans only (`api/oss/src/core/tracing/utils/trees.py:225-254`), and the annotation service writes no such attribute (`traces.py:42-57`).

**Session and turn.** The `session_id` column exists with the index `ix_spans_project_id_session_id` (`api/oss/src/dbs/postgres/tracing/dbas.py:61-74`, `dbes.py:43-47`). Ingest fills it from `ag.session.id` on root spans only (`trees.py:225-254`). An annotation is a root span, so it would get the column if it carried `ag.session.id`, but the annotation service never writes it (`traces.py:42-57`). There is no `turn_id` column today. Ingest keeps only known `ag.*` namespaces and moves any other one, such as `ag.turn` or `ag.annotation`, to `ag.unsupported` (`attributes.py:258-262`; the known names are the fields of `AgAttributes`, `sdks/python/agenta/sdk/models/tracing.py:96-113`).

**Which trace is an annotation.** Ingest marks a whole trace as `annotation` when any of its spans has links, even an empty list; otherwise `invocation` (`trees.py:174-222`, the test at 198). Three things follow:

- Annotations on a testcase in an annotation queue have no link target and are sent with `links: {}` (`web/packages/agenta-annotation/src/state/controllers/annotationFormController.ts:1543`). They are annotations with no subject span.
- The SDK adds the evaluation links to every span of an evaluator run (`sdks/python/agenta/sdk/engines/tracing/processors.py:121-143`), so the whole trace of an automatic evaluator, with its model calls, is marked `annotation`.
- Any run trace that carries an OpenTelemetry span link would also be marked `annotation`.

**The ingest path.** Both routes call `create_trace`, which parses the spans and hands them to `publish_spans` (`tracing/service.py:160-205, 318-336`). The stored row appears after a worker writes it, so a span that a client just sent may not be readable for a short time. Runner spans arrive at the end of a run.

**Editing.** An edit rebuilds all attributes from the edit request and writes the span again (`annotations/service.py:686-741`). Any attribute that the edit does not rebuild is lost.

**Queries.** `POST /spans/query` filters on any attribute path, on the columns, and on `references` and `links` by JSON containment (`api/oss/src/dbs/postgres/tracing/utils.py:97-115, 268-277, 430-453`). A condition with `operator: is` on an attribute path becomes `attributes @> {...}`, which the GIN index `ix_attributes_gin` serves (`dbes.py:64-68`). The `references` and `links` columns have GIN indexes with `jsonb_path_ops` (`dbes.py:69-80`). A link filter value is not flattened before the containment test (`utils.py:268-277`), so a role condition must use the flat key `attributes.key`, as the web app's own comment says (`web/packages/agenta-entities/src/annotation/api/api.ts:249-251`). The annotation query route `POST /annotations/query` filters only on origin, kind, channel, tags, meta, references and links (`traces.py:163-290`), and its route carries the comment "FIX ME / REMOVE ME" (`router.py:89`).

**Retention.** In the paid edition a cron job calls `/admin/spans/flush` at minute 0 and 30 of every hour (`api/ee/src/crons/spans.txt:2`, `spans.sh`). For each plan with a trace window (`Counter.TRACES_INGESTED`, `api/ee/src/core/tracing/service.py:43-53`): one week on Hobby, one month on Pro, three months on Business (`api/ee/src/core/access/entitlements/types.py:76-83, 361-366, 456, 546`), it pages through projects 500 at a time and deletes up to 5,000 traces per page (`service.py:88-128`). A trace is selected when its root span (no parent) has `created_at` before the cutoff, and then every span of that trace is deleted (`api/ee/src/dbs/postgres/tracing/dao.py:177-243`). The selection has no condition on the trace type, so annotations go with the runs. Session rows and turn rows have no time-based deletion: the only delete is an explicit delete of one session by a person, which hard-deletes its turns and its row (`api/oss/src/core/sessions/service.py:348-379`). The other cron jobs flush events, meters and session records (`api/ee/src/crons/`).

**The agent's reference family.** The session start path sends `workflow` and `workflow_revision` references (`api/oss/src/core/sessions/starts/service.py:171-176`). The SDK resolver accepts exactly one of the families `workflow`, `application` or `evaluator` (`sdks/python/agenta/sdk/middlewares/running/resolver.py:81-111`). An application id is the workflow id: the application service passes `application_id` as `workflow_id` (`api/oss/src/core/applications/service.py:114`).

### Who reads or writes annotations outside the core

| Place | What it does | Effect of this change |
|---|---|---|
| `web/packages/agenta-entities/src/annotation/core/schema.ts:121` | validates `links` as a map; a response that fails the check is dropped with no error (`api/api.ts:50-62`) | no change: the annotation routes keep the map shape (D5) |
| `web/packages/agenta-entities/src/annotation/dto/helpers.ts:39, 54` | reads `links.invocation` | keeps working: old roles stay |
| `web/packages/agenta-annotation/src/state/controllers/annotationFormController.ts:1584-1589` | evaluation annotations with role `invocation` or an evaluation step key | keeps working |
| `web/mobile/src/features/observability/annotate/traceAnnotationForm.ts:242` | trace drawer annotations with `links: {invocation: ...}`, origin `human`, channel `web` | keeps working; gains scope `span` and the subject's session and turn |
| `web/mobile/.../traceAnnotationForm.ts:57-62` | decides which annotations a person may edit from `createdById`, `channel`, `origin` and `kind` | no change |
| `sdks/python/agenta/sdk/agents/platform/op_catalog.py:1983-1995` | the agent tool `annotate_trace` binds the link `invocation` to the agent's own current span | no change; the platform finds the session and turn from the turn row (D10) |
| `sdks/python/agenta/sdk/evaluations/runtime/processor.py:680-688` | evaluator runs link to the invocation with role `invocation`, through OTLP | no change in this change |
| `clients/python/agenta_client/`, `web/packages/agenta-api-client` | generated clients; links already typed as map or list | regenerate |
| `api/oss/tests/pytest/acceptance/annotations/*`, `unit/annotations/*`, `unit/tracing/*` | assert the map shape of links | extend; map tests stay valid |

Nothing in the services folder or the runner source writes or reads annotations, apart from the path of `annotate_trace` in a runner unit test (`services/runner/tests/unit/tool-direct.test.ts:231`).

### What we could not verify

- Which credential the runner uses when it calls `annotate_trace` on the API, and so what `created_by_id` holds for those annotations.
- Whether the human evaluators that the web app creates expect `data` or `data.outputs` at the top of their schema (it decides whether `POST /annotations` accepts their payloads; not changed here).
- Whether results of automatic evaluators survive in the evaluation tables after the trace window deletes their traces.
- Whether any run trace of our runner carries an OpenTelemetry span link today, which would mark it `annotation`.
- The speed of the retention query with the new condition, and the storage that kept annotations use. Not measured.
- No query, request or retention run was executed. Every statement comes from reading code.

## Goals / Non-Goals

**Purpose.** An annotation captures raw data so that a learner finds it later. The link to a span only anchors it in a session and in time; nothing depends on which exact span it is. Decided. His words: "aren't we supposed to use this as a way to capture raw data? so that the agent later finds it and leverage it is needed. why do we care so much which exact span is annotated. i think the simplest solution to implement is the onw we should use".

**Goals**

- One general annotation schema (layer 1) for every annotation of every evaluator, written by the platform: the subject's `ag.session.id` and `ag.turn.id`, `ag.annotation.scope`, `ag.annotation.author`, `ag.annotation.actor`, links as a list with a role per link, and the working agent only in the references. Decided. His word on the draft: "lgtm". His words on the earlier draft: "the referencing feels to me part of the reference part of the trace. the soution needs to be general".
- Every annotation about a run links to a span, at every scope. At session scope the link marks the point in time of the feedback. Decided (Option A). His words: "I think you should always link to a span, just because it's kind of the point in time where you're providing feedback for the session. Don't forget that the session can continue after the feedback, so the feedback is always temporal to the last span in which this feedback has been done. I would go with option A."
- Annotations get their own retention, and session and turn rows stay while an annotation names them. Decided. His word: "agree". Annotations are kept until the project is deleted. Decided (Fork 4, his word: "ok").
- One filter answers "all feedback of session s-40" and "all feedback of turn t2".
- Existing annotations and existing clients keep working with no change.

**Non-Goals** (each is a later change)

- The learning evaluator `agenta-learning-record` and its records, the learner tools (`record_feedback`, `leave_signal`, `query_provenance`), the review inbox, and the trust rules that stop a model from setting these fields through those tools.
- A time of the act separate from the time of the write.
- References that name lessons or the program that wrote a record (`writer_agent`).
- UI that shows scope, author or actor. No web app change.
- Schema checks on `POST /simple/traces`, author and actor on evaluator traces that the SDK sends through OTLP, and new filters on `POST /annotations/query`.
- A backfill of old annotations. His words: "We definitely do not care about old traces and old data, right?"

## Dependency

The annotation model depends on the change `sessions-and-spans` (the first fundamental): the runner writes `ag.session.id` and `ag.turn.id` on every span; ingest copies each span's own values into `session_id` and the new indexed column `turn_id`; ingest keeps the `ag.turn` namespace; and the span query accepts the field `turn_id`. Without it, the annotation can still carry the subject's session, but not its turn.

## The target schema

Layer 1 is the agreed draft, with the names of the stored form. The draft writes references as `ag.refs.*`, the form in which the SDK sends them; the annotation service writes the same values as `ag.references.*`, and both end in the `references` column.

```yaml
trace_id: <the annotation's own id, as today>
span_id: ...
attributes:
  ag:
    type: {trace: annotation, span: task}
    references:
      evaluator: {id, slug}            # as today
      evaluator_variant: {id, slug}    # as today
      evaluator_revision: {id, slug, version}
      application: {id, slug}          # the working agent, copied from the run (Proposed)
      application_variant: {id}
      application_revision: {id, version}
    session: {id: s-40}                # the SUBJECT's session, set by the platform
    turn: {id: t2}                     # the SUBJECT's turn, set by the platform
    annotation:
      scope: span                      # span | trace | turn | session
      author: {type: person, user_id: u-3}
      actor:  {type: person, user_id: u-3}
    data:
      outputs: {...}                   # layer 2, the evaluator's output, unchanged
links:                                 # a list, each link with its own role
  - {trace_id: T-b, span_id: sp-91, attributes.key: subject}
  - {trace_id: A-0, span_id: ..., attributes.key: evidence}
columns: {session_id: s-40, turn_id: t2}
```

:::figure scopes
:::

### Where each field lives, and why

| Field | Where | Who sets it | Role of the field | Why there |
|---|---|---|---|---|
| subject's session | attribute `ag.session.id`, copied by ingest into the column `session_id` | platform, from the subject span | index | One filter on an indexed column finds all feedback of a session. The same attribute and column as on run spans (change `sessions-and-spans`), read as "the subject's" on an annotation. Decided. |
| subject's turn | attribute `ag.turn.id`, column `turn_id` | platform, from the subject span | index | Same reason, for a turn. Decided. |
| scope | attribute `ag.annotation.scope` | caller; the only check is that the value is one of the four; default `span` when a subject link exists | classification of the annotation | A filter on it splits session notes from span scores. Few values, so no column is needed; the attribute index serves `is`. Decided, with the four values. |
| author | attribute `ag.annotation.author` `{type, user_id}` | platform only, from the credential | record of who wrote it | Not a request field, so a caller cannot claim another writer. Decided. |
| actor | attribute `ag.annotation.actor` `{type, user_id}` | platform; in this change always equal to the author | data about the judgment | Who acted can differ from who wrote. The field exists now so that readers and later writers share one shape; the request field comes with the learner tools (simplification 5). |
| subject | link with role `subject` (or, for old clients, the first link) | caller names it, or the platform picks it at turn and session scope | pointer to a span | A link needs a trace id and a span id, so the subject is always a span. Decided (Option A). |
| other related records | links with any other role, for example `evidence` or `supersedes`, several per role | caller | pointers | The list with a role per link is the general form. Decided. |
| working agent and revision | references `application`, `application_variant`, `application_revision` | caller, or the platform copies them from the subject's trace when the caller gives none | references | His words: "Agent is a reference. It's an application. As a reference, we already have that." |
| evaluator | references `evaluator*` | caller and platform, as today | references | Unchanged. |
| evaluator output | `ag.data.outputs` | caller | data | Unchanged. Layer 2 is the evaluator's business. |
| `origin`, `kind`, `channel` | flags, as today | caller | classification, kept for old clients | Kept as they are, faults included (D7). |

Author and actor types. This change writes only `person`; the other three values name the writers of later changes and are part of the shared shape:

| Type | Meaning | `user_id` |
|---|---|---|
| `person` | a member of the project, with an Agenta account | the user's id |
| `end_user` | a person outside Agenta, such as a customer of the business, whose identity the platform cannot prove | empty |
| `agent_run` | a run of an agent: the working agent, the builder agent or a learner | empty |
| `platform` | Agenta's own code | empty |

## Decisions

### D1. The subject is a span; the subject link keeps the caller's role (Proposed)

The platform finds the subject span in the request: the link with the role `subject`; if there is none, the first link. (The first link and not "the only link": with simplification 2 nothing is refused, so a request with several links and no `subject` still needs one rule. Old clients send exactly one link, so for them the two rules are the same.) Old clients send one link with the role `invocation` or an evaluation step key (`annotationFormController.ts:1584-1589`, `traceAnnotationForm.ts:242`), so they keep working with no change.

| Option | Trade-off |
|---|---|
| **A. Keep the caller's role; the subject is the link `subject`, else the first link** | No client changes. Two names exist for the subject link in stored data (`subject` from new clients, older roles from old clients). |
| B. Rename the only link's role to `subject` | One name, but the web app reads `links.invocation` (`helpers.ts:39, 54`) and would lose its subject. |
| C. Add a second link `subject` next to the old one | One name for queries, but every old-style annotation stores the same pointer twice. |

An annotation with no link, such as a testcase annotation in a queue, has no subject and no scope. It gets only the author and the actor under `ag.annotation`, which also marks it for retention. Its response is as today. Option A of the founder ("always link to a span") covers annotations about a run.

### D2. The platform derives the session and the turn from the subject span (Proposed)

1. If the request names a subject span, the platform reads that span's row by its key `(project_id, trace_id, span_id)`. If the row exists, the platform copies its `session_id` and `turn_id` columns into `ag.session.id` and `ag.turn.id`, and ignores any `session_id` or `turn_id` in the request. The stored span is the truth; nothing is refused (simplification 2).
2. If the row does not exist yet (a run's spans arrive at the end of the run, and ingest is asynchronous) or no longer exists (retention deleted it), the platform stores the `session_id` and `turn_id` that the request gave, unchecked. If the request gave neither, the platform reads the turn row whose `trace_id` is the subject's trace id (the index `ix_session_turns_project_id_trace_id` serves it) and copies the row's `session_id` and `turn_id`. The runner appends that row when the turn starts, so it exists while the run is still going. This is how the agent tool `annotate_trace`, which annotates its own running span, gets its session and turn (see D10). Today the platform checks no link at all, so the rule is no weaker than today.
3. At scope `turn` or `session` with no link, the request gives `session_id` (and `turn_id` for a turn), and the platform links, with the role `subject`, the span that the turn row already names (Fork 2, decided: the simplest rule). For a turn, that is the row of the turn; for a session, the row of the latest turn (the highest `turn_index`) at the time of the feedback. The platform reads the row's `trace_id` and `span_id` and nothing else: no lookup by time, no ordering of spans, no special case for a resumed run. If the session or the turn has no row, or the row names no span (both fields are optional), the platform stores the annotation with the session and turn that the request gave and no subject link, because the raw data matters more than the anchor. Nothing is refused (simplification 2).
4. At scope `session` the platform never sets `ag.turn.id`, also when the subject span has a turn (simplification 4).

Which id is the turn. A turn row has two ids: `id`, the row key, and the column `turn_id`, which holds the runner's id of the turn's first execution (`api/oss/src/dbs/postgres/sessions/turns/dbas.py`). The change `sessions-and-spans` writes that same value as `ag.turn.id` on every span of the turn, also after a resume. So `turn_id` in a request and on an annotation always means the column `turn_id`, never the row key. No read exists today by that column or by trace id (`fetch_turn` reads by the row key, `latest_turn` by session), so the change adds one DAO read, `find_turn(project_id, session_id?, turn_id?, trace_id?)`, that returns the matching row with the highest `turn_index`. With only a session it is the latest turn. It is internal; the public turn query model does not change.

What the turn row holds (read from code). The runner appends one row per turn when the turn starts, with `trace_id` and `span_id` from the run context (`services/runner/src/engines/sandbox_agent/run-turn.ts:841-842`, `session-continuity-durable.ts:332-361`, stored by `api/oss/src/apis/fastapi/sessions/router.py:2737-2752`). An approval resume tries to append the same turn index, gets 409, and reuses the paused turn's row (`session-continuity-durable.ts:326-331`). Completing a turn updates only the end time, the harness session id, the usage and the attribution, including `approved_by` (`api/oss/src/dbs/postgres/sessions/turns/dao.py:122-190`). So after a resume the row still names the first trace of the turn and its span, not the resumed trace. For the purpose above, that is enough.

### D3. Scope rules

| Scope | Subject link | Session and turn on the annotation |
|---|---|---|
| `span` (default when a subject link exists) | the span itself | the span's own |
| `trace` | the span the caller links, stored as given (simplification 1) | the linked span's own |
| `turn` | the span the request names, or the span the turn row names | the turn's session and the turn |
| `session` | the span the request names, or the span the row of the latest turn names | the session; no turn (simplification 4). The subject link still marks the point in time of the note. |

The four values are decided (Fork 1, his words: "keep it"). The only check is that the scope is one of them; a wrong value answers 422 from the request model, before any service code runs. An annotation with no link and no scope, such as a testcase annotation, gets no scope and no other new field.

### D4. Author and actor

- **Author.** The request has no `author` field. The API sets `{type: person, user_id: <the request's user>}` for every user credential, whether a browser session or an API key: the author is the owner of the credential that wrote the record. Platform code that writes an annotation without an HTTP request (later changes: the review inbox, the learner tools) will pass the author as a service argument.
- **Actor.** In this change the actor always equals the author (simplification 5). The request has no `actor` field. The learner tools of later changes add the field and its rules.
- A member of the project can already write any annotation in the project. The author stops a false writer; the actor carries no claim yet.

### D5. Links as a list with a role per link; the read shape stays a map (Proposed)

`build_otel_links` takes the role of a list item from its `attributes.key`. A list item with no role keeps today's role `"key"`, so a client that sends a list today keeps working. A map input works as today.

The annotation routes keep the read shape of today: `links` is a map from role to link (`traces.py:124-132`). A client that needs every link of a role that repeats reads the annotation through `POST /spans/query`, which returns the stored list. The reason is a trap in the web app: its schema checks `links` as a map (`web/packages/agenta-entities/src/annotation/core/schema.ts:121`), and `parseAnnotationTraces` drops, with no error, each annotation that fails the check (`web/packages/agenta-entities/src/annotation/api/api.ts:50-61`). A list in the response would make annotations disappear from the web app.

| Option | Trade-off |
|---|---|
| **A. Map on the annotation routes, as today; the full list through `POST /spans/query`** | No client sees a change. On the annotation routes, a role that repeats shows one link; an edit through those routes of such an annotation keeps one link per role. Annotations with repeated roles come only from later changes, whose records are append only. |
| B. Map when roles are unique, list when a role repeats | Full data on every route, but the web app drops those annotations until its schema changes. |
| C. Always a list | One shape, but every old client breaks at once. |

### D6. The working agent is copied from the run (Proposed)

When the request gives no `application*` references and the subject span is stored, the platform copies the agent's references from the root span of the subject's trace (runner child spans carry no references; the change `sessions-and-spans` leaves `ag.refs.*` on runner spans to a later change). Runs stay as they are; when the root span carries `workflow` keys, the platform writes them as `application` keys with the same ids. A query on the id alone finds runs and annotations together. Decided (Fork 3, option C, his word: "ok").

### D7. The `auto` fault stays as it is (Proposed)

On `POST /simple/traces`, `origin: auto` reads back as `custom` (Context above). A fix would change a value that existing readers get today, so the change leaves it. With `ag.annotation.author`, a reader no longer needs `origin` to know who wrote an annotation. The fix is named for later.

### D8. Edits keep layer 1 (Proposed)

An edit rebuilds the attributes (`annotations/service.py:703-741`), so the edit path copies `ag.session`, `ag.turn` and `ag.annotation` from the stored annotation. The edit request has no scope, session or turn field, so an edit cannot change them. The links of an edit behave as today: the edit request carries them, and the web app sends back the links it read, so the subject link stays. When the edit request names no `application*` reference, the edit keeps the agent references of the stored annotation, because the web app sends back only the evaluator references (`annotationFormController.ts:1468-1500`). `updated_by_id` records who edited.

### D9. Ingest keeps the namespace (Proposed)

`AgAttributes` gets the field `annotation` with `scope`, `author` and `actor` (`sdks/python/agenta/sdk/models/tracing.py:96-113`), so ingest keeps `ag.annotation` in place instead of moving it to `ag.unsupported` (`attributes.py:258-262`). The change `sessions-and-spans` adds `ag.turn` the same way. The API imports these models from the SDK in the same repository (`api/pyproject.toml:86`), so both ship in the API image.

### D10. The agent tool `annotate_trace` keeps its bindings

The earlier draft bound `annotation.session_id`, `annotation.turn_id` and the actor into the tool from the run context. The citation check found two facts that make that unsafe: a context binding whose value is missing fails the whole tool call (`services/runner/src/tools/direct.ts`, `assembleBody`), and the runner has no turn value in the run context, while runs that a session does not own have no turn id at all (`services/runner/src/protocol.ts`, `turnId`). A binding would therefore make the tool fail in runs where it works today.

| Option | Trade-off |
|---|---|
| A. Bind `$ctx.session.id` and a new `$ctx.turn.id` | The tool sends its session and turn. It fails in every run that has no turn id, and an older runner without `$ctx.turn.id` fails every call. Needs a runner change. |
| **B. Keep today's bindings; the platform reads the turn row by the subject's trace id (D2, rule 2)** | No runner, SDK or tool change, and no new failure. The annotation gets the session and the turn of the run whenever the run is a turn of a session. After an approval resume, the tool's trace is the resumed trace, which the turn row does not name, so that annotation has no session until a later change adds it. |

The actor of the tool's annotations equals the author, the owner of the run credential (simplification 5).

## The write path

1. The route checks the permission `EDIT_ANNOTATIONS`, as today (`router.py:109-114`).
2. The service resolves the evaluator, as today.
3. New: the service builds layer 1 in one function that both routes call: subject (D1), session and turn (D2), scope (D3), author and actor (D4), agent references (D6). It refuses nothing.
4. `POST /annotations` checks `data` against the evaluator schema, as today. `POST /simple/traces` checks no schema, as today.
5. The service writes the span with `ag.session`, `ag.turn` and `ag.annotation` in its attributes and the links with their roles.
6. Ingest keeps the namespaces (D9), marks the trace `annotation` (links are set), and copies `ag.session.id` and `ag.turn.id` into the columns (change `sessions-and-spans`).

What platform code validates:

| Check | Answer |
|---|---|
| `scope` is one of the four values | 422, from the request model |
| `data` against the evaluator schema, on `POST /annotations` only | 422, as today |

Nothing else is new. A wrong or missing session, turn or link never refuses an annotation (simplification 2).

## Three cases, before and after

The ids are shortened for reading (`T-b` stands for a 32-character trace id). All three cases use the working agent `quotes` and session `s-40`: turn `t1` ran trace `T-a`; turn `t2` ran trace `T-b`, paused on the tool call `send_email` (span `sp-91`), and resumed as trace `T-c` after an approval.

### Case 1: a human annotation on a span from an evaluation

A reviewer scores one output of an evaluation run in the web app. The evaluated prompt has no session.

Request today and after the change (unchanged; the web app sends it):

```json
{
  "trace": {
    "origin": "human",
    "kind": "adhoc",
    "channel": "web",
    "data": {"outputs": {"correct": true, "comment": "Right total, wrong currency sign."}},
    "references": {
      "evaluator": {"id": "0b1e5c0e-6a3e-4c1e-9d65-0e2f6f0d1a11", "slug": "correctness"}
    },
    "links": {"invocation": {"trace_id": "E-7", "span_id": "sp-12"}},
    "meta": {"name": "Correctness", "tags": ["correct", "comment"]}
  }
}
```

Stored span before:

```json
{
  "trace_id": "A-1", "span_id": "an-1", "parent_id": null,
  "trace_type": "annotation", "span_type": "task", "span_name": "correctness",
  "session_id": null,
  "created_by_id": "u-3",
  "attributes": {"ag": {
    "type": {"trace": "annotation", "span": "task"},
    "flags": {"is_feedback": true, "is_web": true},
    "meta": {"name": "Correctness", "tags": ["correct", "comment"]},
    "data": {"outputs": {"correct": true, "comment": "Right total, wrong currency sign."}},
    "references": {
      "evaluator": {"id": "0b1e5c0e-6a3e-4c1e-9d65-0e2f6f0d1a11", "slug": "correctness"},
      "evaluator_variant": {"id": "...", "slug": "default"},
      "evaluator_revision": {"id": "...", "slug": "v1", "version": "1"}
    }
  }},
  "links": [{"trace_id": "E-7", "span_id": "sp-12", "attributes.key": "invocation"}]
}
```

Stored span after. The platform adds layer 1. The evaluated invocation has no session, so `ag.session` and `ag.turn` are absent, and so is the agent reference when the invocation carries none:

```json
{
  "trace_id": "A-1", "span_id": "an-1", "parent_id": null,
  "trace_type": "annotation", "span_type": "task", "span_name": "correctness",
  "session_id": null, "turn_id": null,
  "created_by_id": "u-3",
  "attributes": {"ag": {
    "type": {"trace": "annotation", "span": "task"},
    "flags": {"is_feedback": true, "is_web": true},
    "meta": {"name": "Correctness", "tags": ["correct", "comment"]},
    "data": {"outputs": {"correct": true, "comment": "Right total, wrong currency sign."}},
    "references": {
      "evaluator": {"id": "0b1e5c0e-6a3e-4c1e-9d65-0e2f6f0d1a11", "slug": "correctness"},
      "evaluator_variant": {"id": "...", "slug": "default"},
      "evaluator_revision": {"id": "...", "slug": "v1", "version": "1"}
    },
    "annotation": {
      "scope": "span",
      "author": {"type": "person", "user_id": "u-3"},
      "actor": {"type": "person", "user_id": "u-3"}
    }
  }},
  "links": [{"trace_id": "E-7", "span_id": "sp-12", "attributes.key": "invocation"}]
}
```

### Case 2: a feedback on a turn

The owner of the business marks the reply of turn `t2` of session `s-40` as wrong. The app does not know which span to name.

Request before: the client can only name a span, and has no way to say "the turn".

```json
{
  "annotation": {
    "origin": "human", "kind": "adhoc", "channel": "api",
    "data": {"outputs": {"score": 0, "comment": "The labour rate is 50, not 45."}},
    "references": {"evaluator": {"slug": "thumbs"}},
    "links": {"invocation": {"trace_id": "T-b", "span_id": "sp-80"}}
  }
}
```

Request after (`POST /annotations`):

```json
{
  "annotation": {
    "origin": "human", "kind": "adhoc", "channel": "api",
    "data": {"outputs": {"score": 0, "comment": "The labour rate is 50, not 45."}},
    "references": {"evaluator": {"slug": "thumbs"}},
    "scope": "turn",
    "session_id": "s-40",
    "turn_id": "t2",
    "links": []
  }
}
```

Stored span after. The platform links the span that the row of turn `t2` names (`T-b`, `sp-80`, the span of the run context when the turn started; the resume to `T-c` did not change the row), copies the agent from that trace, and sets the author:

```json
{
  "trace_id": "A-2", "span_id": "an-2", "parent_id": null,
  "trace_type": "annotation", "span_type": "task", "span_name": "thumbs",
  "session_id": "s-40", "turn_id": "t2",
  "created_by_id": "u-9",
  "attributes": {"ag": {
    "type": {"trace": "annotation", "span": "task"},
    "flags": {"is_feedback": true},
    "data": {"outputs": {"score": 0, "comment": "The labour rate is 50, not 45."}},
    "references": {
      "evaluator": {"id": "...", "slug": "thumbs"},
      "evaluator_variant": {"id": "...", "slug": "default"},
      "evaluator_revision": {"id": "...", "slug": "v1", "version": "1"},
      "application": {"id": "a4b7887e-1cb5-4194-84cf-669931ba14c6", "slug": "quotes"},
      "application_revision": {"id": "00d78259-5aca-4334-8d49-1ffb59dd6d42", "version": "12"}
    },
    "session": {"id": "s-40"},
    "turn": {"id": "t2"},
    "annotation": {
      "scope": "turn",
      "author": {"type": "person", "user_id": "u-9"},
      "actor": {"type": "person", "user_id": "u-9"}
    }
  }},
  "links": [{"trace_id": "T-b", "span_id": "sp-80", "attributes.key": "subject"}]
}
```

### Case 3: a note on a whole session

After turn `t2`, a team member writes a note on session `s-40`: "The agent asks for the address twice." The session later gets turn `t3`.

Request before: not possible; the closest is a link to some span chosen by the client, with no session.

Request after (`POST /simple/traces`, the route of the web app):

```json
{
  "trace": {
    "origin": "human", "kind": "adhoc", "channel": "web",
    "data": {"outputs": {"note": "The agent asks for the address twice."}},
    "references": {"evaluator": {"slug": "session-notes"}},
    "scope": "session",
    "session_id": "s-40",
    "links": []
  }
}
```

Stored span after. The subject link anchors the note in time: the span that the row of the latest turn (`t2`) names when the note was written. The turn stays empty (simplification 4). Turn `t3`, which comes later, does not change the note:

```json
{
  "trace_id": "A-3", "span_id": "an-3", "parent_id": null,
  "trace_type": "annotation", "span_type": "task", "span_name": "session-notes",
  "session_id": "s-40", "turn_id": null,
  "created_by_id": "u-3",
  "attributes": {"ag": {
    "type": {"trace": "annotation", "span": "task"},
    "flags": {"is_feedback": true, "is_web": true},
    "data": {"outputs": {"note": "The agent asks for the address twice."}},
    "references": {
      "evaluator": {"id": "...", "slug": "session-notes"},
      "evaluator_variant": {"id": "...", "slug": "default"},
      "evaluator_revision": {"id": "...", "slug": "v1", "version": "1"},
      "application": {"id": "a4b7887e-1cb5-4194-84cf-669931ba14c6", "slug": "quotes"},
      "application_revision": {"id": "00d78259-5aca-4334-8d49-1ffb59dd6d42", "version": "12"}
    },
    "session": {"id": "s-40"},
    "annotation": {
      "scope": "session",
      "author": {"type": "person", "user_id": "u-3"},
      "actor": {"type": "person", "user_id": "u-3"}
    }
  }},
  "links": [{"trace_id": "T-b", "span_id": "sp-80", "attributes.key": "subject"}]
}
```

## The query path

All queries run on `POST /spans/query`. The condition `ag.annotation exists` selects annotation records and keeps run spans and evaluator traces out, because after the change `sessions-and-spans` run spans carry the same session and turn columns. (`ag.type.trace: annotation` is the broader trace type, which evaluator traces also have.) No new route and no new index is needed: the columns have indexes, and `in` on `references` and `links` uses their indexes. `exists` on `ag.annotation` is not served by an index; each query also has an indexed condition that narrows the rows first.

Query 1, all annotations about session `s-40`, at every scope:

```json
{"filtering": {"operator": "and", "conditions": [
  {"field": "session_id", "operator": "is", "value": "s-40"},
  {"field": "attributes", "key": "ag.annotation", "operator": "exists"}
]}}
```

Query 2, all annotations about turn `t2` (needs the field `turn_id` from `sessions-and-spans`):

```json
{"filtering": {"operator": "and", "conditions": [
  {"field": "turn_id", "operator": "is", "value": "t2"},
  {"field": "attributes", "key": "ag.annotation", "operator": "exists"}
]}}
```

Query 3, notes on whole sessions of the working agent `quotes` in November. The condition on the reference uses the id alone, so it matches the `application` and the `workflow` family, which share the id:

```json
{"filtering": {"operator": "and", "conditions": [
  {"field": "references", "operator": "in", "value": [{"id": "a4b7887e-1cb5-4194-84cf-669931ba14c6"}]},
  {"field": "attributes", "key": "ag.annotation.scope", "operator": "is", "value": "session"}
]},
 "windowing": {"oldest": "2026-11-01T00:00:00Z", "newest": "2026-12-01T00:00:00Z", "order": "descending"}}
```

Query 4, every annotation that one user's credential wrote. In this change the actor equals the author, so this also counts annotations that the agent tool wrote with that user's run credential:

```json
{"filtering": {"operator": "and", "conditions": [
  {"field": "attributes", "key": "ag.annotation.actor.user_id", "operator": "is", "value": "u-3"},
  {"field": "attributes", "key": "ag.annotation", "operator": "exists"}
]}}
```

Query 5, annotations linked to span `sp-91`. The condition names no role, because old clients store the subject link with their own role (`invocation` or a step key), and new ones with `subject` (D1):

```json
{"filtering": {"operator": "and", "conditions": [
  {"field": "links", "operator": "in",
   "value": [{"trace_id": "T-b", "span_id": "sp-91"}]},
  {"field": "attributes", "key": "ag.annotation", "operator": "exists"}
]}}
```

Query 6, annotations that cite annotation `A-1` as evidence:

```json
{"filtering": {"operator": "and", "conditions": [
  {"field": "links", "operator": "in", "value": [{"trace_id": "A-1", "attributes.key": "evidence"}]},
  {"field": "attributes", "key": "ag.annotation", "operator": "exists"}
]}}
```

`POST /annotations/query` and `POST /simple/traces/query` get no new filters; the web app needs none in this change.

## Retention

:::figure retention
:::

**The rule (Decided, his word: "agree").** Annotations have their own retention class and stay after the traces they link to are deleted. Session rows and turn rows stay while an annotation names them. Annotations are kept until the project is deleted (Decided, Fork 4, his word: "ok").

**How the job changes (Proposed).** The trace flush skips any trace whose root span carries `ag.annotation`:

```python
expired_traces = (
    select(SpanDBE.project_id, SpanDBE.trace_id)
    .where(
        SpanDBE.parent_id.is_(None),
        SpanDBE.project_id == any_(project_ids_param),
        SpanDBE.created_at < cutoff,
        or_(
            SpanDBE.attributes.is_(None),
            not_(SpanDBE.attributes.contains({"ag": {"annotation": {}}})),
        ),
    )
    ...
)
```

The containment test `attributes @> '{"ag": {"annotation": {}}}'` is true when `ag.annotation` exists as an object. The `is_(None)` branch keeps a root span with no attributes deletable, because `NOT (NULL)` is not true in SQL.

| Option for the marker | Trade-off |
|---|---|
| **A. The root span has `ag.annotation`** | Matches exactly the annotation records that the annotation routes write from now on, with or without a link. Old annotations have no marker and leave with the trace window, which the founder accepts ("We definitely do not care about old traces and old data, right?"). Evaluator traces that the SDK sends through OTLP have no marker and keep the trace window. |
| B. `trace_type = annotation` (an evaluator trace too) | Keeps old annotations too, but also every evaluator trace with all its model calls, and any run trace that carries a span link, kept for good. |
| C. A new column or a separate table | Clean to query, but a migration and a second write path for one condition. |

The raw SQL copy of the query (`dao.py:48-74`, `_delete_traces_before_cutoff`) gets the same condition, or is removed if nothing calls it (the service calls `delete_traces_before_cutoff`, `api/ee/src/core/tracing/service.py:114`).

**Session and turn rows.** No time-based job deletes them today (Measured above), so the agreed rule needs no job change. When a person deletes a session by hand, the delete goes ahead, and the annotations stay with their session and turn ids (Decided, Fork 5, his words: "ok, we just need to think later when we build the tools to retrieve this information on how to inform the agent about this").

**An annotation whose subject span is deleted.** The annotation stays. Its subject link points to a missing span, and readers treat that as normal. The `session_id` and `turn_id` columns of the annotation, and the session and turn rows they name, still say what it was about. A query by link still finds the annotation, because the link is stored on the annotation. The web trace drawer cannot open the missing span; it already handles a trace that is not found.

**The open-source edition** has no retention job, so nothing changes there.

## Compatibility

- **Existing annotations.** Unchanged and readable. They have no `ag.annotation`, no session and no turn. Readers treat a missing scope as "unknown". No backfill. His words: "We definitely do not care about old traces and old data, right?"
- **Existing clients.** A request with a map of links, no scope, no session and no actor works as today, and gains scope `span`, the author and, when the subject span is stored, its session and turn. The response keeps the map shape on the annotation routes (D5), and every field that exists today keeps its value. The responses of the annotation routes get no new fields (simplification 3). The agent references that the platform copies (D6) add keys to `references`; the web app reads only the `evaluator*` references of an annotation. The edit permission check of the mobile app reads `createdById`, `channel`, `origin` and `kind`, which do not change.
- **Version skew.** The API ships with the SDK models of the same repository, so the namespace change and the service change arrive together. An older runner that does not yet write `ag.turn.id` leaves `turn_id` empty on its spans; then span-scope annotations on its spans carry no turn, and a turn-scope request still stores the turn that the request gave. Users' own SDK versions talk to the API over HTTP and are not affected. The agent tool does not change (D10), so no runner or services version matters for it.
- **Order.** The change `sessions-and-spans` lands first. If this change lands first, `ag.turn` moves to `ag.unsupported` at ingest, so the order matters.

## What must not break

The founder's words on the proposal: "let's just make sure we dont break evals and annotations for prompts/evaluators, etc..". No existing evaluation or annotation flow changes. Every field that exists today is stored and read back with the same value. The new fields are optional on input and additive on output. The table lists each flow, where it lives (read at `origin/main`), what the change touches near it, and how the flow is protected.

| Flow | Where it lives | What the change touches near it | How it is protected |
|---|---|---|---|
| Human annotation in the web app (trace drawer) | `web/mobile/src/features/observability/annotate/traceAnnotationForm.ts:239-250` creates with `links: {invocation: ...}` through `createAnnotation` (`web/packages/agenta-entities/src/annotation/api/api.ts:72-83`, `POST /simple/traces`); edits pass the read links back (`traceAnnotationForm.ts:225-235`) | the layer 1 builder on `POST /simple/traces`; the edit path | the map input path of `build_otel_links` is unchanged (`traces.py:61-70`); the response keeps the map (D5); an edit copies layer 1 from the stored row (D8); the edit check reads `createdById`, `channel`, `origin`, `kind` (`traceAnnotationForm.ts:57-62`), which keep their values |
| Human annotation in evaluation runs and annotation queues | `web/packages/agenta-annotation/src/state/controllers/annotationFormController.ts:1569-1598` (role `invocation` or a step key) | the layer 1 builder; subject choice | an annotation with one link uses that link as the subject whatever its role (D1); the role is never renamed |
| Testcase annotations in a queue | `annotationFormController.ts:1538-1548` sends `links: {}` | the layer 1 builder | no link means no subject and no scope: the builder adds only the author and the actor, which no response returns, and the retention marker (D1) |
| Reading annotations in the web app | `queryAnnotations` (`api.ts:192-230`, `POST /simple/traces/query`), `queryAnnotationsByInvocationLink` (`api.ts:236-309`, `POST /spans/query`), `parseAnnotationTraces` (`api.ts:50-61`), `links.invocation` reads (`web/packages/agenta-entities/src/annotation/dto/helpers.ts:39, 54`) | the response model | the response shape of `links` stays a map (D5); the query routes are unchanged; the trap that drops an annotation whose links come back as a list cannot fire |
| Automatic evaluator results in evaluations | the SDK runtime links each evaluator run to the invocation with role `invocation` (`sdks/python/agenta/sdk/evaluations/runtime/processor.py:680-688`) and sends the spans through OTLP with the link on every span (`sdks/python/agenta/sdk/engines/tracing/processors.py:121-143`); ingest marks the trace `annotation` (`trees.py:194-205`) | ingest (D9); retention | these traces never pass through the layer 1 builder; ingest only keeps one more namespace; they carry no `ag.annotation`, so the flush deletes them with the trace window exactly as today |
| Annotations on prompt and workflow traces with no session or turn | any of the routes above with a subject span whose `session_id` and `turn_id` are empty | the session and turn copy (D2) | an empty column copies as nothing; no session and no turn are invented; scope `span` is added |
| SDK and API annotation calls | the agent tool `annotate_trace` (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:1983-1995`, `POST /api/annotations/` with a map of links); the generated client (`clients/python/agenta_client/annotations/client.py`) | the layer 1 builder on `POST /annotations` | the request model only gains optional fields; the schema check on `data` is unchanged (`annotations/service.py:155-160`); a running span that is not stored yet does not cause a refusal (D2) |
| Old clients that send or read links as a map | input `SimpleTraceLinks` (`dtos.py:322`); read `parse_named_links` (`traces.py:124-132`) | `build_otel_links` (D5) | the map case is unchanged; a list item with no role keeps the role `"key"` as today |

The only new refusal is a `scope` value outside the four, which needs the new field. A request with none of the new fields (`scope`, `session_id`, `turn_id`) is never refused for a reason that does not exist today.

## Migrations and cost

- No schema migration in this change. The `turn_id` column and its index come from `sessions-and-spans`.
- No data migration and no backfill.
- Write cost: one extra read by primary key of the subject span per annotation, and at turn and session scope one read of a turn row. Not measured.
- Retention cost: one extra condition on the candidate root spans. Kept annotations stay older than the cutoff, so each run reads past them again; their number is small next to run spans. Not measured.
- Storage: annotations are one span each. Kept without a time limit, they grow with use. Not measured.

## Tests

- Unit, API: layer 1 builder: subject choice (D1), derivation from a stored and a missing span (D2), each scope rule (D3), the author and the actor (D4), the scope check.
- Unit, API: `build_otel_links` keeps list roles, keeps `"key"` for a list item with no role, and leaves the map case unchanged; the annotation routes return a map (D5).
- One test per flow of "What must not break" (tasks.md, section 5), the existing suites green, and one end-to-end check per flow on a local deployment before the pull request opens.
- Unit, API: an edit keeps `ag.session`, `ag.turn`, `ag.annotation` and the subject link (D8).
- Unit, ingest: `ag.annotation` stays in place and is not moved to `ag.unsupported` (D9).
- Unit, EE: the retention query skips a root span with `ag.annotation` and deletes a run trace and an old annotation without it.
- Acceptance, API (against a running stack, with the account fixtures of `api/oss/tests/pytest/utils/accounts.py`): the three cases of this document end to end on both routes; Query 1 to Query 6 return the expected annotations; an annotation survives the deletion of its subject trace and still answers Query 1.
- Existing tests that assert the map shape of links stay valid, because the map shape is kept.

## Rollout

One pull request, after `sessions-and-spans` is merged, released with the next API release. No feature flag: every new field is optional, and old requests behave as before. The retention change is in the same pull request; it only keeps more rows. The agent tool, the runner and the web app need no change.

## What is deliberately not built

- The learning evaluator, its records and its trust rules; the learner tools; the review inbox.
- A time of the act; lesson references; the `writer_agent` references.
- A UI for scope, author, actor or session feedback.
- Schema checks on `POST /simple/traces`; new filters on the annotation query routes.
- Author and actor on evaluator traces that arrive through OTLP.
- A request field for the actor, and its rules (simplification 5).
- A backfill of old annotations.
- The fix of the `auto` fault on `POST /simple/traces` (D7), and the list shape of `links` on the annotation routes (D5).
- Named for later, from the founder's note on Fork 5: when the retrieval tools of the learners are built, they must tell the learner that an annotation names a session or a turn that was deleted.

## Risks / Trade-offs

- A caller can name a session and turn for a span that is not stored yet, and the platform stores them unchecked (D2). The alternative, to refuse, would break the agent tool `annotate_trace` and any client that annotates a run right after it ends.
- Kept annotations grow without a limit, because they stay until the project is deleted (Fork 4).
- The subject link has two possible role names in stored data (D1). Readers use "the link `subject`, else the first link".
- The scope of an annotation from an old client is a default (`span`), not a statement of the person.

## Migration

None. See "Migrations and cost".

## The founder's decisions on the forks

All five forks are decided. The decision page shows them without code.

### Fork 1. Does `trace` stay a scope? Decided

Option A: keep `trace`; the scope has four values: `span`, `trace`, `turn`, `session`. His words: "keep it".

### Fork 2. Which span does a turn or session annotation link to when the caller names none? Decided

The simplest rule to implement: the span that the turn row already names; for a session, the row of the latest turn at the time of the feedback (D2). His words: "i dont understansd why this question matters? aren't we supposed to use this as a way to capture raw data? so that the agent later finds it and leverage it is needed. why do we care so much which exact span is annotated. i think the simplest solution to implement is the onw we should use".

### Fork 3. Which reference family names the agent? Decided

Option C: runs stay as they are; annotations always write the `application` keys; a query on the id finds both (D6). His word: "ok".

### Fork 4. How long are annotations kept? Decided

Option A: until the project is deleted. His word: "ok".

### Fork 5. What happens when a person deletes a session that annotations name? Decided

Option A: the delete goes ahead; the annotations stay and keep the session and turn ids. His words: "ok, we just need to think later when we build the tools to retrieve this information on how to inform the agent about this". The note is a named later item, outside this change (see "What is deliberately not built").

## Corrections after the citation check

The citations were checked against `8d6f0dff68` before the implementation. The line numbers hold, with these corrections. The code is the truth where it differed.

- The two routes check different permissions: `POST /annotations` checks `EDIT_ANNOTATIONS`, `POST /simple/traces` checks `EDIT_SPANS`. Both pass the request's user to the service as `UUID(request.state.user_id)`. The write path step 1 means the permission of each route.
- The edit paths differ on links. `POST /annotations` keeps the stored links when the edit has none (`annotations/service.py:376-380`). `POST /simple/traces` writes `trace_edit.links or {}` (`tracing/service.py:1278`), so an edit there with no links drops all links, the subject link included. This change keeps both as they are (D8); the web app sends the links back in every edit.
- The create responses return the request's `links` as sent (`annotations/service.py:238`, `tracing/service.py:1240`), so a list in a create request comes back as a list. This change keeps that; "the annotation routes keep the map shape" means the read and query responses.
- A turn row has two ids (row key `id` and column `turn_id`); see D2. No read exists by `turn_id` or `trace_id`; the change adds `find_turn`.
- The context bindings of the agent tool cannot set constants and fail on a missing value; see D10.
- `OTelLink` is defined at `sdks/python/agenta/sdk/models/tracing.py:154-159`; `api/oss/src/core/shared/dtos.py:42-45` only imports it.
- The span row gets its `turn_id` column from the change `sessions-and-spans`; on the base commit it does not exist.
- `delete_session` (`sessions/service.py:348-379`) also hard-deletes the interactions, mounts and stream of the session, not only its turns and row.
- `sessions/turns/dao.py:122-175` is `122-190`.

