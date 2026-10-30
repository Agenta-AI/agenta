Correctness

Intent

Find the ways this change makes the product do the wrong thing: wrong results, lost or
corrupted data, flows that stop halfway, and behavior that worked before and no longer does.
Judge the net change from the diff base to the head commit. Anything already at the diff base
is existing code, not the subject of the review, unless the change makes an existing problem
reachable.

First understand what the change is trying to do. Read the description, the tests, and the
code around each changed function. Then follow every workflow, route, state change, and rule
the change touches from start to finish, including the callers of every changed function and
the readers of every changed field.

What to look for

Bugs in the new code. Wrong conditions, inverted checks, off-by-one limits, missing awaits,
unhandled None or empty values, wrong defaults, exceptions that escape or get swallowed,
wrong types across a boundary, and string or time handling that breaks on real input (time
zones, encodings, large values).

Regressions. A changed signature, field, default, status code, event shape, or config key
that an existing caller still uses the old way. Search for every caller and reader, including
other services, the frontend, the SDK, workers, and scripts. A rename that misses one reader
is a regression. Removed behavior that someone depends on is a regression unless the change
says so on purpose.

Broken flows. A state that the new code can enter but cannot leave. A step that runs on the
happy path but not after a retry, a cancel, a timeout, or a restart. A write that happens
without the matching write elsewhere (both sides of a link, a counter and its rows, a cache and
its source). Error paths that leave a half-done result visible to the user.

Concurrency and retries. Two requests, workers, or tabs that act on the same row at the same
time. Read-then-write without a lock, a unique constraint, or a conditional update. Duplicate
delivery of a message or webhook. A retry after a side effect already happened (a send, a
charge, an external call) with no idempotency key. Background tasks that outlive the request
or the transaction they depend on.

Migrations and data loss. A migration that fails on existing rows (nulls, duplicates, large
tables, long locks). A column or table dropped or renamed while running code still reads it,
given that old and new versions run side by side during a deploy. A downgrade path that loses
data. A backfill that is not idempotent. Deletes or overwrites that remove user work without a
guard.

Tests. Check whether the tests prove the new behavior and the edge cases above, or only match
the code as written. A test that mocks away the part that can fail does not count as proof.

What not to raise

Style, naming, and simplicity points belong to other lenses. Do not raise a theoretical
problem without a path to reach it. Timeouts, restarts, duplicate delivery, and interrupted
requests are ordinary conditions in systems that cross process or network boundaries, so a
problem they trigger is reachable.

Rating

Base the rating on severity (what the user loses), reach (how ordinary the trigger is), and
recovery (whether the user or an operator can see and fix it).

- Low: no reachable bug, or only small problems with easy, visible recovery.
- Medium: at least one reachable bug or regression in a real flow, with limited impact or a
  visible recovery path. The approach is sound and the fix is local.
- High: data loss or corruption, a broken core flow, a migration that can fail or lose data in
  production, or a problem the approach itself causes so the fix needs a different design.

Report each concrete problem as a finding anchored to the changed code. The rationale names the
two strongest reasons for the rating.
