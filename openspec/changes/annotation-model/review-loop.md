<!-- review-loop: design=b7a4228892bc lenses=simplify,naming -->

**Review loop result** for the design of `annotation-model` at repo commit `8d6f0dff68`, 3 rounds.

| Lens | Final rating |
| --- | --- |
| Simplify | Low |
| Naming and interface roles | Low |

**Fixed:**
- A session-scope anchor reads the existing latest-turn query; a new internal read covers only the turn id and the trace id.
- The design defines "annotation record" (written by the annotation routes, carries `ag.annotation`) and "evaluator trace" (trace type `annotation` from OTLP, no `ag.annotation`). Retention and the query examples use `ag.annotation` as the marker. Testcase annotations get the author and the actor, so they are kept like every other annotation record.
- The design defines "turn id" as the session turn's id, the same value as `ag.turn.id` and the span column `turn_id`, never the turn row's own key.
- The invocation request model no longer inherits the three new annotation fields.
- The query for annotations linked to a span names no role, because old clients keep their own role for the subject link.
- The spec separates the create response (links as sent, as today) from the read and query responses (a map).
- The proposal no longer lists response fields, an origin fix or a web change.

**Left on purpose:**
- The request field keeps the name `turn_id`, because the span column and the span query field use that name for the same value.
- The author and actor type keeps the value `person`, because the approved draft schema uses it. In this change the actor equals the author, so annotations that the agent tool writes carry the user of the run credential as both.
- One internal read `find_turn` with optional filters, because the trace lookup has no session.
