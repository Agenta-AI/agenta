# Context

## User Request

From Slack conversation with a user integrating Agenta for observability:

> "How do we filter by `tags.created_at` in between a date range?"

The user stores a datetime as a string attribute (`tags.created_at = "2024-01-15T10:30:00Z"`) and wants to query spans where this value falls within a range.

## Current Limitation

The tracing filter system has operator families:

| Operator Family | Supports `>` / `<`? | Notes |
|-----------------|---------------------|-------|
| `StringOperator` | **No** | Only pattern matching: `contains`, `like`, `startswith`, `endswith`, `matches` |
| `NumericOperator` | Yes | But casts to `FLOAT` - fails on non-numeric strings |
| `ComparisonOperator` | No | Only `is` / `is_not` (JSONB containment) |

## Why This Matters

1. **Common use case**: Users store timestamps, version strings, or other ordered data as string attributes
2. **ISO8601 dates sort lexicographically**: `"2024-01-15" < "2024-01-20"` works as expected with string comparison
3. **Workaround is clunky**: Storing a separate numeric timestamp field doubles the data

## Goals

1. Enable `gt`, `lt`, `gte`, `lte` operators on string attributes
2. Support lexicographic comparison (PostgreSQL's natural text ordering)
3. Expose these operators in the UI for string-type fields

## Non-Goals

- **NOT** adding date/datetime parsing or timezone handling - users are responsible for consistent string formats
- **NOT** changing how existing operators work
- **NOT** adding `between` for strings (can be composed with `gte` + `lte`)
