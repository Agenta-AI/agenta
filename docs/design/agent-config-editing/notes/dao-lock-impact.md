# The variant lock on `commit_revision`: impact and alternatives

For the review of the S1b-lock lane, by Mahmoud and the CTO. Written 5 August 2026.

This note answers the three conditions attached to the lock decision: which other flows
commit through the same DAO path and why each is unaffected, why the lock beats a unique
constraint, and what the lane actually contains.

## 1. What the lane changes

`GitDAO.commit_revision` (`api/oss/src/dbs/postgres/git/dao.py:1565`) gains one optional
parameter, `expected_head_revision_id`. When a caller passes it, the DAO:

1. locks the variant row with `SELECT ... FOR UPDATE`,
2. **re-reads the head revision id under that lock**,
3. raises `RevisionConflict` when it differs from the caller's expectation,
4. otherwise inserts as before.

The lock condition becomes `initial or expected_head_revision_id is not None`. A caller
that passes neither takes no lock and behaves exactly as it does today.

### 1.1 Why the re-read is part of this lane, and not optional

The scoping said "only the lock-condition change". A lock alone does not give the
invariant, so the lane would not be reviewable as a safety change without the re-read.

The base comparison lives in the service today, before the DAO is called. With only a
lock added, two writers still both succeed:

```text
A: reads head N (its own transaction) -> base check passes -> DAO: lock, insert, commit
B: reads head N (its own transaction) -> base check passes -> DAO: lock (waits), insert
```

The lock serialized the inserts. It did not catch the stale base, because B checked before
it held the lock. Only a read taken **while holding the lock** can see A's insert. That is
three added lines inside the same locked block, and it is what makes the lock mean
anything.

The service keeps its own pre-check as a cheap early-out: it fails the common case one
round trip earlier and produces the same 409.

## 2. Every flow that commits through this DAO

`GitDAO` is never subclassed, and `commit_revision` has exactly six production callers.
The git layer is shared by **four** domains, each binding its own DBE triplet.

| Domain | Commits at | Passes the new parameter? |
|---|---|---|
| workflows | `core/workflows/service.py:1953` | Only from the checked commit path (S1b-main). |
| environments | `core/environments/service.py:1106` | No. |
| testsets | `core/testsets/service.py:1039` | No. |
| queries | `core/queries/service.py:976` | No. |

`applications`, `evaluators`, and `prompts` are **not** separate git domains. They are
façades over `WorkflowsService`, so they reach the same workflows call site and are covered
by that row.

The two remaining callers are the DAO's own `fork_variant`
(`dao.py:969` and `:994`), which replays revisions into a new variant in a loop.

### 2.1 Why each is unaffected

Every one of them is unaffected for the same structural reason: **the new behavior is
opt-in at the call site, and nothing but the workflows checked-commit path opts in.** The
parameter defaults to `None`, the lock condition is unchanged when it is `None`, and no
existing caller was edited.

Flow by flow:

- **environments, testsets, queries.** They never pass `expected_head_revision_id`. Their
  commits take no lock, exactly as today. Their `initial=True` calls keep the lock they
  already had, with the same guard.
- **applications and evaluators.** They call `commit_workflow_revision`, which is the
  unchecked entry point. S1b-main routes only the workflow commit ENDPOINT through
  `commit_workflow_revision_checked`; these façades keep calling the original method,
  which passes nothing new.
- **`fork_variant`.** The loop is the flow most exposed to a new lock, because it commits N
  revisions in sequence. It passes neither `initial` nor an expectation, so it takes no
  lock and its cost is unchanged. Had the lock been made unconditional, this loop would
  have taken and released the same row lock once per replayed revision.
- **Data migrations.** Five OSS and five EE data migrations construct a `GitDAO` and commit
  through the service methods in long loops
  (`api/oss/databases/postgres/migrations/core/data_migrations/`). None passes an
  expectation, so no migration takes a new lock. This matters: an unconditional lock would
  have been taken thousands of times during a migration run.
- **Direct inserts that bypass `commit_revision` entirely.** `GitDAO.create_revision`
  (`dao.py:1008`) is a separate insert path used by all four domains, and three migrations
  insert revision rows directly (including one raw `INSERT INTO workflow_revisions`). These
  are unaffected because they are untouched — but see section 5, because they are also
  outside the invariant.

### 2.2 The one shared cost

Two concurrent CHECKED commits on the same variant now serialize. That is the intended
behavior and the only new contention. Two commits on different variants never meet: the
lock is one row, scoped by project and variant.

## 3. Why the lock, and not a unique constraint

A unique constraint on parent linkage (a `(variant_id, parent_revision_id)` uniqueness, or
a uniqueness on the version sequence) would also serialize writers: the second inserter
would fail the constraint and could be mapped to 409.

It is rejected for one decisive reason and two supporting ones:

1. **It needs a migration, and migrations are excluded.** The revision tables have no
   parent-linkage column today, so the constraint needs both a schema change and a backfill
   over every existing revision in every one of the four domains. Decision 6 already
   excluded schema migrations from this work.
2. **It would constrain all four domains at once.** A table constraint is not opt-in. The
   moment it exists, environments, testsets, queries, `fork_variant`, and every data
   migration are subject to it, and any of them that legitimately produces two revisions
   with the same parent starts failing. The lock is a per-call parameter, so its blast
   radius is exactly the callers that ask for it.
3. **It reports the wrong thing.** A constraint violation says "this row already exists",
   not "the head moved to N+1". The caller needs the current head id to retry in one step
   (`contracts/commit-transaction.md` 6.1). Recovering it after a violation means another
   read anyway.

An advisory lock (`pg_advisory_xact_lock`) was also considered. It avoids touching the
variant row, but it is a second locking scheme to reason about, and the variant row lock
already exists in this method for the `initial` guard. Reusing it keeps one mechanism.

## 4. The sharp edge the reviewers should know about

`AsyncEngine.session()` returns an `async_scoped_session` keyed on the current asyncio task
(`api/oss/src/dbs/postgres/shared/engine.py:47-50`). **Within one task, a nested
`async with engine.session()` yields the SAME session, not a savepoint.** The inner block's
`await session.commit()` commits the outer work, and its `await session.close()` closes the
shared session.

Consequences for this lane:

- The lock is held from the `SELECT ... FOR UPDATE` to the explicit `await session.commit()`
  inside `commit_revision`. The insert happens inside that window, so the guard and the
  insert are atomic. This is true today for the `initial` guard and stays true for the new
  one.
- The post-insert helpers (`_get_version`, `_set_version`, `_null_revision_fields`) open
  what looks like a nested session and therefore run AFTER the lock is released. They are
  bookkeeping on the row just inserted, not part of the invariant, so this is acceptable —
  but it is not obvious from reading the code, and anyone extending this method should know
  it before they move work around.
- It also means the invariant cannot be widened to span the service's head read by simply
  wrapping the call in a session: the service's read and the DAO's insert would share one
  session and one transaction, which changes the failure semantics of every other caller.
  Moving the whole apply step inside the DAO transaction, as
  `contracts/commit-transaction.md` section 3.1 describes, remains the way to close the
  remaining window.

## 5. What this lane does NOT give

Stated plainly, so the review does not over-read it:

- **The service-side apply is still outside the lock.** S1b-main reads the head, applies
  the change set, then calls the DAO. The DAO's re-read closes the window between the
  service's check and the insert, which is the window that matters for two concurrent
  writers. It does not make the read-apply-insert sequence one transaction. The full
  invariant needs the `build` callback of `commit-transaction.md` section 3.1.
- **`create_revision` is not covered.** It inserts revisions on a separate path with no
  guard at all, including the `initial` one. Nothing in this lane changes that. If the
  "one initial revision" invariant matters, that path is a hole today, independent of this
  work.
- **Nothing protects against a writer that passes no expectation.** A legacy commit still
  wins last-write. That is deliberate: shipped playbooks omit the base id, and refusing
  them would break them.

## 6. Tests

`api/oss/tests/pytest/unit/git/test_commit_revision_lock.py` (10 tests) pins:

- an unchecked commit takes no lock (every existing caller's behavior),
- an initial commit still takes the lock, and the lock precedes its count guard,
- a checked commit takes the lock, and the head read happens under it, not before,
- a moved head refuses, inserts nothing, and reports both ids,
- a matching head commits,
- an empty variant accepts any expectation (the first checked commit must be possible),
- neither conflict is swallowed by `suppress_exceptions`,
- the two-writer sequence: the winner inserts, the loser's re-read sees the new head and
  refuses.

They drive the DAO's ordering with a fake session, so they run in the unit suite with no
database. **A two-writer test against real Postgres, with two genuine connections, belongs
in the integration suite** and is not in this lane: the unit tests prove the ordering and
the refusal, but only a real database proves the lock actually blocks.
