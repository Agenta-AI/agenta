# Session trace privacy (M9)

Status: the trace filtering part (M9b) is replaced by `small-team-roles`. Roles decide who reads traces: a `member` has no trace read, and every other role reads every trace in its project. M9b covered trace filtering by session access, linkage, the read scope and unavailable marking. Only per-turn usage (M9a, `turn-usage`) remains.

## Why

M3 makes sessions private but keeps one exception: any project member with `VIEW_SPANS` reads the traces of every session, and traces hold the full turn content. M9 closes it before M7 adds personal credentials. Cost and token displays read the trace today, so a user who can read a session but not its trace would lose them.

## What Changes

- **Per-turn usage** (`turn-usage`, separable). Tokens and cost are stored on each turn. Displays read the turn, not the trace.
- **Replaced by `small-team-roles`: trace filtering by session access** (`trace-session-access`). A trace linked to a session that the reader may not read is hidden, child spans included, also after a private session is deleted. Every user-triggered trace read goes through one read-scope boundary (CONTRACT.md section 11).
- **Replaced by `small-team-roles`: unavailable, never zero** (`trace-metrics-availability`). Restricted analytics are marked. A figure the reader may not see shows as unavailable. Access errors fail closed.

## Non-goals

- An analytics permission or content-free project totals.
- Changes to trace storage layout, retention or billing collection.
- Filtering copies of span content already stored in evaluation results, annotations, testsets or exports.
- Per-span visibility and admin access to private trace content.
