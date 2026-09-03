# Review standard for the session-control RFC and its work packages

Source: Mahmoud, 2026-09-03. The staff-engineer test list (sections 1 to 14 and the weighting
table) is a Codex answer that Mahmoud asked us to take into account. The four review points and
the trade-off note are Mahmoud's own words. Reviewers apply this standard to the RFC on
`agent/session-execution-rfc` (PR #6495) and to every work package and implementation PR that
follows from it.

## The four review points (Mahmoud)

1. Simplify. How can we simplify the implementation and reach the goals with less risk? Find the
   trade-off between a simpler system, a clear system with a nice API, a reliable system that works
   well, an extensible system that can later scale by changing parts instead of a rewrite, and a
   simple migration path with little need for big data migrations or risky changes.
2. Check whether the designed system follows the organization practices of this repository
   (`AGENTS.md`, `api/AGENTS.md`, `web/AGENTS.md`, the `agenta-package-practices` skill).
3. Check whether the interfaces follow the `design-interfaces` skill.
4. Check whether the system is well designed from a staff-engineer perspective.

Over-engineering versus quality is a trade-off that the review must name explicitly. Reference
points, to be taken with a grain of salt:
https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md and
https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail-review/SKILL.md.

## How a staff engineer would test this system (Codex, quoted)

### 1. User trust and recoverability

This is the most important product requirement. The reviewer asks:

- Can Stop ever destroy the conversation?
- Can a failed execution permanently block the session?
- Can accepted user input disappear?
- Can an approval answer disappear after acceptance?
- After a runner, sandbox, API, Redis, or Postgres failure, can the user send another message?
- Does previously committed history remain available?
- Does the interface clearly say whether work stopped, failed, became lost, or is waiting?

The central invariant is: every accepted execution reaches one visible terminal outcome, and the
session remains usable afterward. For Agenta before product-market fit, this matters more than
high availability or large-scale throughput.

### 2. Correctness under concurrency

The system must behave correctly when actions overlap, even with only one runner. The reviewer
tests:

- Two messages arrive together.
- Stop arrives while an execution completes.
- Stop and an approval response arrive together.
- The client retries after losing an HTTP response.
- The API delivers the same command twice.
- An old runner sends output after the watchdog ends its execution.
- An old Stop request arrives after a new execution begins.

The desired properties are: at most one active execution per session; one committed winner for
conflicting actions; idempotent retries; optional execution guards for delayed requests; one
effective terminal outcome; no stale output entering visible history. These races already happen
with one API and one runner. They are not premature scaling concerns.

### 3. Execution control

For Stop: the API accepts it durably; the runner receives it within five seconds; the harness
stops new work; active tool processes end; the system records a stopped outcome; the sandbox
remains warm only when it is safe; a later message continues successfully.

For Queue and Steer: accepted input is durable and visible; Stop does not accidentally start
queued work; Steer saves the new message before interrupting current work; a failed interruption
does not lose the steering message. The public meaning should stay independent from the
transport used to reach the runner.

### 4. Conversation continuity

- What survives a browser refresh? An API restart? A runner restart? A sandbox restart?
- Can the harness restore its native session?
- If native restoration fails, can durable history reconstruct enough context?
- Do files remain available?
- Does stopping a tool leave side effects or child processes behind?

The system can use different internal recovery mechanisms. The user-facing result must remain
consistent.

### 5. Live experience across clients

- Does the sending browser still receive token-level output?
- Can another browser join during an execution? Can mobile watch the same execution?
- Do all clients eventually display the same durable messages and tools?
- Does refresh recover cleanly? Can a slow client affect the runner?
- Does a temporary streaming failure damage durable history?

Temporary frames provide responsive animation. Durable events provide recovery and truth. Missing
temporary animation is acceptable during failure. Missing committed conversation state is not.

### 6. Durable history and ordering

- Does every durable fact have a stable ID? Are retries true duplicates rather than new events?
- Can a record change after it has become durable?
- Is ordering assigned when Postgres commits?
- Can a reader request everything committed after sequence N?
- Can replay transition to live delivery without losing an event?
- Can existing sessions still load without backfill? Is incomplete history explicitly visible?

Durable history has one database-defined order, and retries cannot change it. The implementation
can remain modest. It does not need a globally distributed event system.

### 7. Public and private boundaries

- Do clients call public session operations rather than runner-specific endpoints?
- Is the durable command table private?
- Can direct delivery later become long polling without changing public APIs?
- Can Redis Streams later be replaced without rewriting session state rules?
- Does the client depend on database or Redis implementation details?
- Does the runner depend on browser connection behavior?
- Do desktop, mobile, and external clients use the same public meanings?

Good boundaries matter more than general abstractions. Each interface should hide one thing
likely to change. The valuable boundaries are: command repository, command delivery, execution
ownership, live-frame ingress, durable history, snapshot and event reading.

### 8. Failure isolation

- Can a slow browser slow the runner? Can a failed SSE connection stop execution?
- Can Redis frame loss prevent durable persistence?
- Can Postgres failure cause Redis work to be acknowledged too early?
- Can a failed notification hide a committed record?
- Can a stuck watchdog block later sweeps?
- Can malformed data in one batch discard unrelated records?

A failure in live delivery may reduce freshness, but it must not damage execution control or
durable history.

### 9. Operational visibility

Logs and metrics for: command accepted, delivered, retried, applied, obsolete, or lost; Stop
request-to-runner latency; harness cancellation latency; watchdog settlements; rejected late
records; record-ingest retries; incomplete histories; ownership lease expiry; slow-reader
disconnections; Redis frame eviction; warm continuation success; sandbox destruction after unsafe
cancellation. Every important failure answers: which session, which execution, which command,
which runner, what happened, can the user continue. Structured logs, counters, and stable
identifiers are enough initially.

### 10. Security and authorization

- Every session read verifies project access.
- Temporary frames use the same authorization as durable history.
- Stop and approval responses verify session access.
- Runner control routes require private authentication.
- Clients cannot choose arbitrary runner targets.
- Execution guards cannot expose another session's identifiers.
- Tool permissions work consistently across harnesses.
- Logs and metrics do not introduce new secret exposure.

Every authorized session reader follows the same policy.

### 11. Migration safety

- Existing invoke clients continue working. Existing records remain readable.
- Old sessions do not require a risky backfill. New database columns are nullable where needed.
- Desktop and mobile migrate before old endpoints disappear.
- The sender can keep using invoke while secondary-reader streaming is tested.
- Features can be enabled gradually. Every migration has a clear rollback point.

Additive migration is preferable to a clean rewrite.

### 12. Cost and implementation weight

- Does this solve a demonstrated problem? What breaks if we do not build it now?
- Can existing Postgres, Redis, HTTP, and SSE handle it?
- Are we introducing another service without needing it?
- Are we persisting every token when completed checkpoints are sufficient?
- Are we building multiple-runner coordination before multiple runners exist?
- Can one small adapter preserve a future option?
- Is a migration necessary, or can old data remain unchanged?

The standard is the smallest system that satisfies the reliability requirements without blocking
a reasonable future migration.

### 13. Scaling path without scaling now

- Can command delivery change behind its port?
- Can execution ownership move from Redis to a durable generation later?
- Can browser fan-out move to a specialized service later?
- Can frame streams be partitioned by session? Can API replicas remain stateless?
- Can one busy session avoid blocking unrelated sessions?
- Are sequences scoped per session rather than globally?
- Are limits measurable and configurable?

The system does not need to implement these future mechanisms. It should avoid making them
impossible.

### 14. Test evidence

Contract tests for public and private interfaces. Transaction tests for races and idempotency.
Failure injection for Redis, Postgres, runner, sandbox, and API interruptions. Local and Daytona
validation. Pi, Claude Code, and Codex coverage. Two browsers and mobile for shared reading. Exact
commit, identifiers, logs, and database state for live tests. A continuation message after every
failure scenario.

The strongest QA assertion: the error appeared, one terminal state was stored, ownership was
released correctly, committed history remained, and the next message succeeded.

### Weighting

| Weight | Area |
|---|---|
| Critical | Session remains usable after every failure |
| Critical | Accepted input and committed history are not lost |
| Critical | Stop is fast, safe, and warm |
| Critical | One active execution and one terminal outcome |
| High | Multiple clients converge on the same state |
| High | Retry, race, and disconnect correctness |
| High | Authorization and private runner control |
| High | Additive migration for existing sessions |
| Medium | Operational logs and metrics |
| Medium | Replaceable transport boundaries |
| Medium | Resource limits and backpressure |
| Low for now | Multiple-runner correctness |
| Low for now | Global-scale event infrastructure |
| Low for now | Exactly-once delivery across every component |
| Out of scope | Kafka, Temporal, or another platform solely for future scale |

The staff-level question: does this design give users a trustworthy session today, while
preserving clear replacement points for the parts we may need to scale later?

### Simplicity and necessity

For every proposed component, table, endpoint, state, and abstraction:

- What current user problem requires this? What breaks if we do not build it now?
- Can existing code already satisfy the requirement?
- Can we change an existing path instead of creating another path?
- Can we delete or consolidate code as part of the change?
- Is the abstraction hiding a real point of change, or only predicting one?
- Can we defer this without making today's implementation harder to replace?
- Does the new mechanism introduce another source of truth?

Governing rule: write the least code that satisfies the confirmed requirements and passes the
failure matrix. A small patch that preserves a broken architecture can create more work. Avoid
code that does not improve current behavior or protect a necessary future boundary.

## How reviewers report

- One file per reviewer under `reviews/` in this folder, named by model and date.
- Each finding: the file and section it targets, the weight from the table above, the concrete
  failure or cost, and the proposed change. Findings without a proposed change are questions and
  go in a separate list.
- Mark every conclusion as agent-generated and low weight.
