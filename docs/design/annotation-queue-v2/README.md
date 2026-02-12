# Annotation Queue v2

A redesign of the annotation queue system to make human annotation a first-class capability across multiple data sources.

## Problem Statement

The current `EvaluationQueue` implementation is tightly coupled to evaluation runs (`run_id` is required). This works for human evaluation within eval runs but creates friction for other annotation use cases like annotating traces, test sets, or programmatically submitted items.

## Documents

| Document | Description |
|----------|-------------|
| [context.md](./context.md) | Background, motivation, current state analysis |
| [prd.md](./prd.md) | Product requirements, user stories, acceptance criteria |
| [rfc.md](./rfc.md) | Technical proposal with three solution options and tradeoffs |
| [research.md](./research.md) | Analysis of current implementation, code references |
| [competitive-analysis.md](./competitive-analysis.md) | Analysis of competitor's metadata-based approach |

## Solution Summary

| Solution | Approach | Effort | Recommendation |
|----------|----------|--------|----------------|
| **A** | Extend evaluation runs as container | 2-3 weeks | If eval-centric |
| **B** | New annotation domain with task entity | 4-5 weeks | If annotation is core |
| **C** | Metadata-based queues (no new tables) | 1-2 weeks | **Recommended for v1** |

**Recommendation**: Start with Solution C for fastest time-to-value, upgrade to B if/when sophisticated features are needed.

## Status

- **Phase**: Design
- **Author**: Planning Agent
- **Created**: 2026-02-12
- **Last Updated**: 2026-02-12

## Quick Links

- Current implementation: `api/oss/src/core/evaluations/` (queue-related code)
- API endpoints: `POST /preview/evaluations/queues/`
- Database: `evaluation_queues` table
