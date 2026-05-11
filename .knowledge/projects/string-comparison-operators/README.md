# String Comparison Operators for Tracing Filters

Add lexicographic comparison operators (`>`, `<`, `>=`, `<=`) to string attributes in the tracing/observability filter system.

## Problem

Users store datetime strings in custom attributes (e.g., `tags.created_at = "2024-01-15T10:30:00Z"`) and want to query ranges. Before this work:

- The UI did not expose `gt`/`lt`/`gte`/`lte` for string custom fields
- String field parsing in core did not allow numeric comparison operators
- DAO string-field handling did not route numeric operators for plain string columns

## Solution

Reuse existing `NumericOperator` values (`gt`, `lt`, `gte`, `lte`) for strings by allowing them in string parsing and routing them in DAO handling. PostgreSQL naturally supports lexicographic comparison on text, so ISO8601 datetime strings sort correctly.

## Files

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, user request |
| [plan.md](./plan.md) | Execution plan with phases |
| [research.md](./research.md) | Code analysis and implementation details |
| [status.md](./status.md) | Current progress |

## Effort Estimate

**Low complexity** - ~2-3 hours total

- Backend: ~1 hour (parser + handler routing changes)
- Frontend: ~1 hour (registry + field config changes)
- Testing: ~30 min
