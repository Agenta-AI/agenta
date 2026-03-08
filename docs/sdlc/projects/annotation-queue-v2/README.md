# Annotation Queue v2

A redesign of the annotation queue system to make human annotation a first-class capability across multiple data sources.

## Problem Statement

The current `EvaluationQueue` implementation is tightly coupled to evaluation runs (`run_id` is required). This works for human evaluation within eval runs but creates friction for other annotation use cases like annotating traces, test sets, or programmatically submitted items.

## Documents

| Document | Description |
|----------|-------------|
| [context.md](./context.md) | Background, motivation, current state analysis |
| [prd.md](./prd.md) | Product requirements, user stories, acceptance criteria |
| [rfc.md](./rfc.md) | Original technical proposal with three solution options (A, B, C) |
| [rfc-v2.md](./rfc-v2.md) | **Current RFC**: Simplified interface over existing evaluation entities (based on Feb 24 discussion) |
| [research.md](./research.md) | Analysis of current EvaluationQueue implementation, code references |
| [research-human-eval-implementation.md](./research-human-eval-implementation.md) | How human evaluation works today: frontend components, state, API calls, annotation storage |
| [competitive-analysis.md](./competitive-analysis.md) | Analysis of competitor's metadata-based approach |

## Current Direction

Use existing `EvaluationRun` + `EvaluationQueue` entities as the backbone. Build a **convenience API layer** that hides evaluation run machinery from annotation consumers. No new domain entities.

See [rfc-v2.md](./rfc-v2.md) for the full proposal.

## Status

- **Phase**: Design (RFC v2 ready for review)
- **Created**: 2026-02-12
- **Last Updated**: 2026-02-24

## Quick Links

- Current implementation: `api/oss/src/core/evaluations/` (queue-related code)
- API endpoints: `POST /preview/evaluations/queues/`
- Database: `evaluation_queues` table
