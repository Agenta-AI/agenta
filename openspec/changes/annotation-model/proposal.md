## Why

An annotation is a stored judgment about a run of an agent, a prompt or an evaluator: a score, a label, a comment or a correction. In Agenta an annotation is a span alone in its own trace, and a link points from it to the span it judges. A span is one recorded step of a run, and a trace is the tree of spans that one run makes.

Today an annotation cannot say which session or turn it is about, only which span. A session is one conversation with an agent, and a turn is one exchange in it. So "all feedback of session s-40" has no filter. An annotation also cannot say who acted, only whose credential wrote it. A list of links with a role per link is accepted, but every role is stored as the literal `key`. The paid edition deletes annotations together with old traces.

The founder approved a general annotation schema on 16 November 2026 (his word on the draft: "lgtm"). He asked that it serve every evaluator: "the referencing feels to me part of the reference part of the trace. the soution needs to be general". He chose that every annotation links to a span, also for a whole session: "I think you should always link to a span, just because it's kind of the point in time where you're providing feedback for the session. [...] I would go with option A." On a retention of their own for annotations he wrote "agree".

The change is the second fundamental of the learning system. The first, `sessions-and-spans`, puts the session id and the turn id on every span of our runner. Later parts (the learning records, the learner tools, the review inbox) write and read annotations in this schema.

## What Changes

- Every annotation written through `POST /annotations` or `POST /simple/traces` carries the session and the turn of its subject as `ag.session.id` and `ag.turn.id`. The platform copies them from the subject span, and ingest copies them into the indexed columns `session_id` and `turn_id`. Decided ("lgtm").
- A new attribute `ag.annotation.scope` says what the annotation judges: `span`, `trace`, `turn` or `session`. The request may give the scope; the default is `span`. The only check is that the value is one of the four; no combination of scope, link, session and turn is refused. At session scope the turn stays empty. Decided, with the four values (his words on keeping `trace`: "keep it").
- New attributes `ag.annotation.author` (who wrote the record) and `ag.annotation.actor` (who acted), each `{type, user_id}`. The platform sets the author from the credential. In this change the actor always equals the author; the request field for the actor comes later with the learner tools. Decided.
- Every annotation about a run links to a span with the role `subject`, at every scope. At turn and session scope the request may give only the session and turn, and the platform links the span that the turn row already names (decided: "i think the simplest solution to implement is the onw we should use"). The link only anchors the annotation; nothing depends on which exact span it is. Old clients keep their own role name for their one link. Decided (Option A); the pick rule is Proposed.
- A list of links keeps the role of each link, so several links can share a role. Proposed.
- The responses of the annotation routes get no new fields; readers use `POST /spans/query`. The working agent and its revision are named only in the references, copied from the run when the request gives none. Decided ("Agent is a reference. It's an application."); annotations always write the `application` keys, and runs stay as they are (his word: "ok").
- The trace flush of the paid edition skips annotations. They are kept until the project is deleted (his word: "ok"). No time-based job deletes session or turn rows today, so the agreed rule for them needs no job change; a person's explicit delete of a session goes ahead, and the annotations keep their ids (his words: "ok, we just need to think later when we build the tools to retrieve this information on how to inform the agent about this").
- No existing evaluation or annotation flow changes: human annotations in the web app and in queues, automatic evaluator results, annotations on prompts and workflows, testcase annotations, the SDK calls and old clients. The founder's words: "let's just make sure we dont break evals and annotations for prompts/evaluators, etc..".
- No migration and no backfill. His words: "We definitely do not care about old traces and old data, right?"

## Capabilities

### New Capabilities

- `annotation-model`: the general annotation schema (layer 1) for every evaluator: subject session and turn, scope, author, actor, links with roles, the agent in the references, the write and query rules, and the retention of annotations.

### Modified Capabilities

None.

## Impact

- API: `api/oss/src/core/tracing/dtos.py` (three optional input fields; no response field), `api/oss/src/core/tracing/utils/traces.py` (links with roles, layer 1 attributes), `api/oss/src/core/annotations/context.py` (one layer 1 builder for both routes), `api/oss/src/core/tracing/service.py` and `api/oss/src/core/annotations/service.py` (call the builder, edits keep layer 1), `api/ee/src/dbs/postgres/tracing/dao.py` (the flush skips annotation records).
- SDK: `sdks/python/agenta/sdk/models/tracing.py` (the `ag.annotation` namespace). The agent tool `annotate_trace` does not change; the platform finds its session and turn from the turn row (design D10).
- Sessions: one internal read of a turn row by session, turn id or trace id (`api/oss/src/dbs/postgres/sessions/turns/dao.py`).
- Web app: no change. The annotation routes keep the map shape of `links`, so the web app's check still passes.
- Generated clients: regenerate from the paid-edition API spec.
- Depends on: `sessions-and-spans` (ids on every runner span, the `turn_id` column, the `ag.turn` namespace, the `turn_id` query field).
- Size: one pull request, about 15 files, about 1,000 lines including tests. No migration.

### Later changes, not in this one

- The learning evaluator `agenta-learning-record` and its records.
- The learner tools and the review inbox, and the trust rules that stop a model from setting these fields through them.
- A UI for scope, author, actor or session feedback.
- When the retrieval tools of the learners are built, they tell the learner that an annotation names a session or a turn that was deleted (the founder's note on deleted sessions).
