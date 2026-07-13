# Managed external resource reconciliation

Planning workspace for the durable reconciliation layer that follows the process-local Daytona
Secret delivery in PR #5277. This branch contains design documents only; it does not add API code,
migrations, workers, or deployment wiring.

## Files

- `context.md` - Problem, goals, non-goals, and success criteria.
- `research.md` - Existing Agenta patterns and candidate reuse cases.
- `design.md` - Proposed reusable managed-resource boundary.
- `api-design.md` - Reviewable API, data, identity, and migration shape.
- `plan.md` - Stack boundaries, design gate, sequencing, and acceptance tests.
- `status.md` - Current state, decisions, open questions, and next action.
