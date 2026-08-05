# Findings: Query Eval Loops

- Path: `application/docs/designs/query-eval-loops`
- Scope: last two commits on `feat/extend-query-eval-loops`
- Origin: `scan`
- Lens: `verification`
- Depth: `deep`

## Notes

- Review covered the design docs in this folder plus the implementation commit `86642444f` and the preceding design commit `6a0335434`.
- Findings below are based on code and API review. They are not based on a fresh end-to-end runtime repro in this document.
- Targeted checks were not re-run during the resolve pass because test execution was explicitly skipped by user direction.

## Open Findings

- None.

## Closed Findings

### [CLOSED] F001 - Mixed source queue requests are accepted by the request model and downgraded to a silent no-op

- ID: `F001`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Compatibility`
- Summary: queue creation accepted invalid mixed request shapes like `kind + queries` or `kind + testsets`, then returned `200` with `count=0` instead of a validation error.
- Evidence:
  - `SimpleQueueData.validate_sources` now rejects `kind + queries` and `kind + testsets`.
  - Acceptance coverage was added for the mixed `kind + queries` request shape.
- Files:
  - [types.py](/Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/types.py:623)
  - [test_simple_queues_basics.py](/Users/junaway/Agenta/github/application/api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py:181)
- Cause: validation for mixed source forms was split across the request model and service layer, with the service converting the invalid combination into `None`.
- Explanation: invalid mixed source requests now fail at request validation time instead of degrading into false-success API responses.
- Suggested Fix: implemented by tightening `SimpleQueueData` validation.
- Alternatives:
  - Service-layer `400` handling would also work, but would delay failure until after request parsing.
- Sources:
  - local code changes in this resolve pass

### [CLOSED] F002 - Source-backed queue add endpoints reject writes as silent no-ops instead of explicit client errors

- ID: `F002`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Functionality`
- Summary: `POST /simple/queues/{id}/traces/` and `POST /simple/queues/{id}/testcases/` returned success-shaped empty responses when called against source-backed queues, instead of explicit invalid-operation errors.
- Evidence:
  - `SimpleQueuesService.add_traces` and `add_testcases` now raise `BadRequestException` when the target run is source-backed.
  - Acceptance coverage now expects `400` for both invalid direct-add paths.
- Files:
  - [service.py](/Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/service.py:3609)
  - [test_simple_queues_basics.py](/Users/junaway/Agenta/github/application/api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py:201)
- Cause: invalid operation handling used a sentinel `None` return instead of an explicit API error.
- Explanation: callers now receive a concrete `400` rejection message when they use the wrong endpoint for a source-backed queue.
- Suggested Fix: implemented by raising explicit bad-request errors from the service path.
- Alternatives:
  - A structured non-error rejection payload would be weaker and less clear for clients.
- Sources:
  - local code changes in this resolve pass
