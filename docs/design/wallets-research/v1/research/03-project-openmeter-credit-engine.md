# OpenMeter's credit and entitlement engine, and what we should take from it

## What this document is for

We are designing two systems. The first is a gateway, meaning a service of ours that sits between a
user's agent container and a model provider, holds the real provider credential, and decides per
request whether to forward the call. The second is a ledger, meaning a balance per organization that
we derive from a list of entries we never edit.

OpenMeter is the project on our shortlist that has already built the second one, or something close
to it. This document reads its source and reports how it actually behaves, then judges which parts
fit our situation.

Everything here comes from the source at commit `04651cba84afb96d14ae8165993b934a05607863`, pushed 3
August 2026. The repository is https://github.com/openmeterio/openmeter. It is Apache License 2.0,
written in Go, 2,172 stars and 200 forks (verified through the GitHub API on 3 August 2026). The
license permits us to copy both the design and the code.

File paths in this document are relative to the root of that repository, unless the path starts with
`api/` or `web/`, in which case it is the Agenta repository at `/home/mahmoud/code/agenta`.

## The vocabulary you need, defined once

These words appear constantly in OpenMeter's code and in the rest of this document.

A **ledger** is a list of entries that only grows. You never edit a row. If you made a mistake you
add a correcting row. The **balance** is not a stored truth. It is the sum of the entries, and any
stored balance is a cache of that sum.

A **debit** removes value from a balance. A **credit** adds value to it. A **grant** is one deposit
of allowance, for example "500 credits, valid for 90 days, given for writing a skill". A system that
keeps each grant separate instead of adding all of them into one number is said to use **credit
lots**. Lots matter when grants expire on different dates or must be spent in a particular order.
That is our case exactly, because a signup grant, a purchase, and a contribution reward should not
expire together.

**Metering** means counting what someone used, for example tokens or seconds of container time. It
answers "how much did they consume". An **entitlement** answers a different question: "are they
allowed to consume this at all". In OpenMeter an entitlement is a row that connects one customer to
one metered feature, and it owns the grants for that feature.

**Burn down** is OpenMeter's word for applying usage against grants. The **burn order** is the rule
that decides which grant gets consumed first.

**Overage** is usage that no grant could cover. OpenMeter records it as a positive number rather
than letting a balance go negative.

An **idempotency key** is a caller supplied identifier attached to a write, so the same write sent
twice is applied once. If our gateway retries a charge after a timeout, the key is what stops the
user paying twice.

A **hold** (also called an authorization or a reservation) is value set aside before the real amount
is known. Your card at a fuel pump is the classic case. The station holds a round number, you pump
an unknown amount, and the station then **settles** for the true amount and releases the rest. That
is our shape, because we do not know what a model call costs until the response comes back.

A **snapshot** in OpenMeter is a saved row that says "at this moment, each of these grants had this
much left". It exists so a balance read does not have to replay all history.

**Reconciliation** means comparing our numbers against an outside record, for example the provider's
own invoice, and explaining every difference.

## The one structural fact that shapes everything else

OpenMeter has no debit rows. There is no table of consumption anywhere in the credit engine.

Usage lives in ClickHouse as raw metering events. When OpenMeter needs to know how much a customer
used between two times, it runs an aggregation query against ClickHouse. The credit engine receives
that number through a single function pointer, `QueryUsageFn`, declared as
`func(ctx, from, to time.Time) (float64, error)` at `openmeter/credit/engine/engine.go:78`.

So the credit engine is not a ledger in the accounting sense. It is a pure function. You give it a
list of grants, a starting snapshot, an end time, and a way to ask "how much was used between A and
B". It gives you the balance at the end and a history of how it got there. Nothing about a burn is
persisted except the snapshots, and the snapshots are a cache that can be thrown away and rebuilt.

This is elegant and it works because ClickHouse can re-answer any usage question at any time. We do
not have ClickHouse and I do not think we should adopt it for this. That single difference is what
separates "copy the design" from "copy the architecture", and it comes back in the judgment section.

## The data model

Four tables carry the whole system. I show the real Postgres DDL, trimmed to the interesting
columns.

### The grants table

Source of truth for the shape: `openmeter/ent/schema/grant.go:28-64`. Real DDL:
`tools/migrate/migrations/20240826120919_init.up.sql`.

```sql
CREATE TABLE "grants" (
  "id"                 character(26) NOT NULL,   -- ULID
  "namespace"          character varying NOT NULL,
  "owner_id"           character(26) NOT NULL,   -- FK to entitlements(id)
  "amount"             numeric NOT NULL,         -- how much was granted
  "priority"           smallint NOT NULL DEFAULT 0,
  "effective_at"       timestamptz NOT NULL,     -- when it starts counting
  "expiration"         jsonb NOT NULL,           -- {"count": 12, "duration": "MONTH"}
  "expires_at"         timestamptz NOT NULL,     -- computed from the two above
  "voided_at"          timestamptz NULL,         -- set when a grant is cancelled
  "reset_max_rollover" numeric NOT NULL,
  "reset_min_rollover" numeric NOT NULL,
  "recurrence_period"  character varying NULL,   -- ISO 8601 duration, e.g. "P1M"
  "recurrence_anchor"  timestamptz NULL,
  "metadata"           jsonb NULL,
  "created_at"         timestamptz NOT NULL,
  "updated_at"         timestamptz NOT NULL,
  "deleted_at"         timestamptz NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "grants_entitlements_grant" FOREIGN KEY ("owner_id")
    REFERENCES "entitlements" ("id")
);
CREATE INDEX "grant_effective_at_expires_at" ON "grants" ("effective_at", "expires_at");
CREATE INDEX "grant_namespace_owner_id"      ON "grants" ("namespace", "owner_id");
```

Almost every column is marked immutable in the schema definition. Look at
`openmeter/ent/schema/grant.go:35-55`: `owner_id`, `amount`, `priority`, `effective_at`,
`expiration`, `expires_at`, `reset_max_rollover`, `reset_min_rollover`, `recurrence_period` and
`recurrence_anchor` all carry `.Immutable()`. Only three columns change after insert: `voided_at`,
`deleted_at`, and `updated_at`. So a grant is append only in practice, with two soft state flags.

The Go view of a grant is at `openmeter/credit/grant/grant.go:14-60`. Its doc comment opens with
"Grant is an immutable definition used to increase balance".

Two things about `priority`. It is a `uint8` in Go and a `smallint` in Postgres, and lower numbers
burn first. The public API documents it as 1 to 255 (`api/openapi.yaml:18481-18492`), but the
database default is 0 and nothing enforces the minimum inside the engine.

There is no amount remaining column. A grant never records how much of it is left. Remaining balance
is always computed.

### The balance_snapshots table

Source of truth: `openmeter/ent/schema/balance_snapshot.go:27-68`. The original DDL is in the same
init migration, with two later columns added by
`tools/migrate/migrations/20250307151454_balance-snapshot-usage.up.sql:2` and
`tools/migrate/migrations/20260728090000_om_400_unit_config_entitlement_and_balance_snapshot.up.sql:2`.
Combined:

```sql
CREATE TABLE "balance_snapshots" (
  "id"             bigint GENERATED BY DEFAULT AS IDENTITY,
  "namespace"      character varying NOT NULL,
  "owner_id"       character(26) NOT NULL,      -- the entitlement
  "at"             timestamptz NOT NULL,        -- the moment this balance was true
  "grant_balances" jsonb NOT NULL,              -- {"<grant_id>": 42.5, ...}
  "balance"        numeric NOT NULL,            -- the sum of grant_balances, denormalised
  "overage"        numeric NOT NULL,            -- usage no grant could cover
  "usage"          jsonb NULL,                  -- {"usage": 17.0, "since": "..."}
  "unit_config"    jsonb NULL,                  -- unit conversion regime, see below
  "created_at"     timestamptz NOT NULL,
  "updated_at"     timestamptz NOT NULL,
  "deleted_at"     timestamptz NULL,            -- soft delete used for invalidation
  PRIMARY KEY ("id")
);
CREATE INDEX ON "balance_snapshots" ("namespace", "owner_id", "at") WHERE deleted_at IS NULL;
```

So a snapshot row answers, for one entitlement at one instant: how much is left in each individual
grant, the total, how much usage went uncovered, and how much has been used since the start of the
current usage period. The per-grant map is the important part. Without it you cannot resume a burn,
because you would not know which lot to take the next unit from.

The Go structure is `balance.Snapshot` at `openmeter/credit/balance/balance.go:81-93`, and
`balance.Map` is a plain `map[string]float64` from grant ID to remaining amount
(`openmeter/credit/balance/balance.go:23`).

Snapshot rows are never updated. `Save` always inserts (`openmeter/credit/adapter/balance_snapshot.go:65-88`,
which builds a `CreateBulk`). Invalidation sets `deleted_at`. Nothing in the repository prunes old
snapshots, so the table grows for the life of the account. I searched for a cleanup job and found
none.

The `unit_config` column is worth one sentence because it teaches a lesson. It records the unit
conversion rule in force when the snapshot was computed. On read, if the entitlement's current rule
differs from the snapshot's rule, the code refuses to resume and recomputes from the beginning
(`openmeter/credit/helper.go:42-58`). That is the right instinct: a cached value carries a stamp of
the assumptions under which it was computed, and a mismatch invalidates it rather than silently
mixing regimes.

### The usage_resets table

Defined at `openmeter/ent/schema/usage_reset.go:27-41`. Columns: `entitlement_id`, `reset_time`,
`anchor`, `usage_period_interval` (an ISO 8601 duration string). Every column is immutable. This is
an append only log of "the monthly allowance was reset at this moment".

### The entitlements table

I will not reproduce it. The parts the credit engine reads are the current usage period, the
measure-usage-from time, the soft-limit flag, and the linked meter. The important detail is that the
entitlement row is the thing that gets locked, which I cover under concurrency.

## How a balance is produced

Not stored. Not incrementally updated. Computed on every read, from the most recent usable snapshot
forward.

The read path is `GetBalanceAt` at `openmeter/credit/balance.go:125-146`. It does three things.

1. Round the query time up to the next whole minute (`openmeter/credit/balance.go:135-137`).
2. Fetch the latest snapshot at or before that time (`GetLastValidSnapshotAt`, implemented at
   `openmeter/credit/helper.go:26-61`). If there is none, build a zero snapshot at the entitlement's
   start of measurement and plan to replay everything
   (`openmeter/credit/helper.go:68-84`).
3. Replay forward from that snapshot (`getBalanceSinceSnapshot`, `openmeter/credit/balance.go:44-123`).

The snapshot query itself is one statement: rows for this owner, `at <= T`, `deleted_at IS NULL`,
ordered by `at` descending then `updated_at` descending, take the first
(`openmeter/credit/adapter/balance_snapshot.go:42-63`).

The replay loads every grant that was active at any point in the window
(`ListActiveGrantsBetween`, `openmeter/credit/adapter/grant.go:211-238`) and hands them plus the
snapshot to the engine.

### The engine

The engine's whole contract is nine lines. `RunParams` at `openmeter/credit/engine/engine.go:16-30`
carries the meter, the grants, the end time, the starting snapshot, the reset behaviour, and the
list of reset moments. `RunResult` at `openmeter/credit/engine/engine.go:50-57` carries the ending
snapshot and the burn-down history.

Inside, `Run` (`openmeter/credit/engine/run.go:17-103`) splits the window at every reset, then calls
`runBetweenResets` for each piece.

`runBetweenResets` (`openmeter/credit/engine/run.go:124-270`) is where the real work happens. It
cuts the window into **phases**. A phase is a stretch of time in which the burn order cannot change.
`getPhases` (`openmeter/credit/engine/burnphase.go:34-160`) builds the cut points from two sources:
moments when a grant becomes active, expires, is deleted or is voided
(`getGrantActivityChanges`, `openmeter/credit/engine/grant.go:17-63`), and moments when a recurring
grant refills (`getGrantRecurrenceTimes`, `openmeter/credit/engine/grant.go:66-153`).

For each phase, the engine asks the usage function how much was consumed in that phase, then burns
it down against the grants that were active at the start of the phase
(`openmeter/credit/engine/run.go:233-241`).

The burn itself is 39 lines, `burnDownGrants` at `openmeter/credit/engine/run.go:275-313`. It walks
the prioritised grant list, and for each grant either drains it completely and carries the remainder
forward, or takes what it needs and stops. Whatever remains unmatched at the end becomes overage.

### The trade-off they accepted, and why

Computing on read costs a database round trip for the snapshot plus one ClickHouse aggregation per
phase. In exchange they get three things.

Correctness under late data. Metering events arrive late all the time. Because usage is re-queried
rather than applied once, a late event simply changes the answer the next time you ask. There is a
configurable grace period, default one day, during which no snapshot is written precisely so late
events keep being included (`app/config/entitlements.go:12-17` and `:42-45`).

Correctness under retroactive change. Adding a grant, voiding a grant, or resetting a period does
not require rewriting any consumption record. You delete the snapshots that came after and let the
next read rebuild them.

A cheap audit story. Because the engine returns a full history alongside the balance, "why is my
balance this" is answered by the same call that answers "what is my balance".

What they gave up is the ability to answer the balance question without an analytical database, and
the ability to record a charge as a fact. There is no row anywhere that says "this request cost
this much". That is a big loss for us and I return to it.

## The burn order

This is the part worth copying verbatim. `PrioritizeGrants` at
`openmeter/credit/engine/grant.go:176-229` sorts in three stable passes, applied in reverse order of
importance so the last sort wins:

1. First it sorts by `created_at`, then by `id` as a tie break
   (`openmeter/credit/engine/grant.go:184-193`). This exists only to make the result deterministic.
2. Then it sorts by expiration, soonest first, with grants that never expire pushed to the end
   (`openmeter/credit/engine/grant.go:196-221`).
3. Then it sorts by priority ascending, so the lowest priority number burns first
   (`openmeter/credit/engine/grant.go:224-226`).

Because Go's `SortStable` preserves the order of equal elements, the effective rule is: lowest
priority number first, then soonest expiry, then oldest creation, then lowest ID.

I ran the engine's test suite to confirm this rather than trusting the comment.
`go test ./openmeter/credit/engine/...` passes with 49 subtests. The specific case at
`openmeter/credit/engine/run_test.go:508-543` grants two lots of 100, gives the first `Priority = 1`
and the second `Priority = 2`, applies 120 units of usage, and asserts that the first ends at 0 and
the second ends at 80. So the lower number is drained first, completely, before the higher number is
touched.

This maps directly onto our three sources of credit. Give the signup grant priority 1 so it burns
first and cannot be hoarded. Give contribution earnings priority 2. Give purchased credits priority
3 so a person who paid us keeps their money longest. That ordering falls out of one small integer
column and one sort.

## When a snapshot is written, and what invalidates it

### Written

The write happens as a side effect of a read. At the end of `getBalanceSinceSnapshot`
(`openmeter/credit/balance.go:111-119`) the code calls `snapshotEngineResult`, implemented at
`openmeter/credit/helper.go:200-240`.

That function starts by trying to lock the owner **without waiting**:

```go
if err := transaction.RunWithNoValue(ctx, m.GrantRepo, func(ctx context.Context) error {
    return m.OwnerConnector.LockOwnerForTx(ctx, snapParams.owner, false)
}); err != nil {
    // If we failed to acquire the lock we simply don't save the snapshot
    return nil
}
```

That is `openmeter/credit/helper.go:204-209`. The design choice is explicit and I like it: a
snapshot is a cache, so if someone else holds the lock, skip writing it and move on. Reads never
block each other.

Then it walks the history segments backwards and saves the newest segment boundary that is old
enough (`openmeter/credit/helper.go:221-237`). "Old enough" is
`getSnapshotNotAfter(periodStart, now)` at `openmeter/credit/connector.go:52-60`, which returns the
later of "now minus the grace period" and "the start of the current usage period". With the default
one-day grace period, in a long billing month nothing newer than 24 hours old gets snapshotted, so
late events for the last day always land.

Two more restrictions. Snapshots are skipped entirely for meters whose aggregation is `LATEST`,
because those values fluctuate (`openmeter/credit/helper.go:211-215`). And a snapshot's timestamp
must be aligned to the engine's granularity, which is one minute
(`openmeter/credit/helper.go:247-249`).

### Invalidated

One method does it: `InvalidateAfter`, at `openmeter/credit/adapter/balance_snapshot.go:28-40`.

```go
return rep.db.BalanceSnapshot.Update().
    Where(
        db_balancesnapshot.OwnerID(owner.ID),
        db_balancesnapshot.Namespace(owner.Namespace),
        db_balancesnapshot.AtGT(at),
        db_balancesnapshot.DeletedAtIsNil(),
    ).
    SetDeletedAt(clock.Now()).
    Exec(ctx)
```

One statement. Soft delete every snapshot whose `at` is after the given time. It is called from
exactly two places: after creating a grant (`openmeter/credit/grant.go:109-113`) and after voiding
one (`openmeter/credit/grant.go:183-187`). Both calls happen inside the same transaction as the
grant write, and both happen after taking a blocking lock on the owner.

That is the whole invalidation story. There is no version counter, no cache key, no event. A stale
snapshot is impossible because the only two operations that can change history also delete the
snapshots that came after.

## The retroactive grant question, answered precisely

We asked what happens when a grant is inserted with an `EffectiveAt` in the past, behind an existing
snapshot. This is our contribution-reward case: someone published an article three weeks ago and we
want to credit them as of then.

OpenMeter refuses. `CreateGrant` at `openmeter/credit/grant.go:72-79`:

```go
periodStart, err := m.OwnerConnector.GetUsagePeriodStartAt(ctx, ownerID, clock.Now())
if err != nil {
    return nil, err
}

if input.EffectiveAt.Before(periodStart) {
    return nil, models.NewGenericValidationError(fmt.Errorf(
        "grant effective date %s is before the current usage period %s",
        input.EffectiveAt, periodStart))
}
```

So you may backdate a grant only within the current usage period, which for a monthly entitlement
means back to the start of this month. Anything earlier is rejected outright.

Voiding has the mirror rule. `VoidGrant` at `openmeter/credit/grant.go:147-160` rejects a void time
in the future and rejects a void time before the current usage period start.

Within the allowed window the mechanism is simple and correct. Take a blocking lock on the owner,
insert the grant, soft delete every snapshot after `effective_at`, publish an event, commit
(`openmeter/credit/grant.go:81-119`). The next balance read finds no snapshot after that point, so
it resumes from an earlier one and replays through the new grant.

The reason for the restriction is not the snapshot machinery. It is that a period reset already
happened and its rollover was already computed, so changing history before it would change what
rolled over. That is a consequence of having usage periods and rollover at all. If we do not build
periods and rollover, we do not inherit this restriction, and unrestricted backdating becomes safe.

That is a real finding for us: **the reason OpenMeter cannot credit someone retroactively is a
feature we do not need.**

## Idempotency

There is none inside the credit engine, and there cannot be, because the engine never applies a
charge. It reads a total from ClickHouse.

Idempotency is handled one layer out, at event ingestion. The interface is
`openmeter/dedupe/dedupe.go`, and the deduplication key is a three-part tuple: namespace, event ID,
and event source (`openmeter/dedupe/dedupe.go:33-41`). Those come from the CloudEvents envelope, so
the producer supplies the ID.

The production implementation is Redis, at `openmeter/dedupe/redisdedupe/redisdedupe.go:78-100`. It
is a `SET` with mode `nx` and a TTL:

```go
status, err := d.Redis.SetArgs(ctx, key, "", redis.SetArgs{
    TTL:  d.Expiration,
    Mode: "nx",
}).Result()
```

If the key already existed, the event is a duplicate and is dropped. If not, it is unique and gets
processed. There is a self-aware comment about the weakness at `openmeter/sink/sink.go:352`: "Least
once guarantee, if Redis write fails we potentially accept messages with same idempotency key in
future". So duplicate protection is best effort with a time window, not a durable guarantee.

For a client that retries after a timeout, the answer is therefore: the retry carries the same
CloudEvents ID, Redis rejects it, and the meter is not double counted, provided the retry happens
inside the TTL and Redis has not lost the key.

There is one place with real database-backed idempotency, and it is in the newer billing code rather
than the credit engine. `openmeter/billing/creditgrant/service.go:108-110` takes an optional `Key`
described as "the optional idempotency key: a retried create with the same key returns a conflict".
It is enforced by a partial unique index, at `openmeter/ent/schema/chargescreditpurchase.go:144-156`:

```go
// Idempotency key, unique per customer within a namespace. Partial so it is enforced
// only while live: NULL means no idempotency requested, and a soft-deleted grant must
// not permanently reserve a key the caller may reuse.
index.Fields("namespace", "customer_id", "key").
    Annotations(entsql.IndexWhere("key IS NOT NULL AND deleted_at IS NULL")).
    Unique(),
```

That is the pattern we should copy for grants, and the comment explains exactly why it is partial.

## Concurrency

Two mechanisms, one old and one new.

### The credit engine: a row lock on the owner

Every write path takes `SELECT ... FOR UPDATE` on the entitlement row before touching grants or
snapshots. The interface is `LockOwnerForTx(ctx, id, wait bool)` at
`openmeter/credit/grant/owner_connector.go:72`. The implementation is at
`openmeter/entitlement/adapter/entitlement.go:850-874`:

```go
func (a *entitlementDBAdapter) LockEntitlementForTx(ctx context.Context, tx *entutils.TxDriver,
    entitlementID models.NamespacedID, wait bool) error {
    pgLockNotAvailableErrorCode := "55P03"

    if tx == nil {
        return fmt.Errorf("lock entitlement for tx called from outside a transaction")
    }
    _, err := a.WithTx(ctx, tx).db.Entitlement.
        Query().
        Where(db_entitlement.ID(entitlementID.ID), db_entitlement.Namespace(entitlementID.Namespace)).
        ForUpdate(func() []sql.LockOption {
            if !wait {
                return []sql.LockOption{sql.WithLockAction(sql.NoWait)}
            }
            return nil
        }()...).
        Only(ctx)
    ...
}
```

The `wait` flag is the interesting part. Grant creation, grant voiding, and reset all pass `true`
and block until they get the lock (`openmeter/credit/grant.go:81`, `:173`, and
`openmeter/credit/balance.go:314`). Snapshot writing passes `false` and gives up immediately
(`openmeter/credit/helper.go:205`), because a snapshot is only a cache.

Now the honest part. **This does not protect two concurrent spends against each other, because
OpenMeter has no concurrent spend path.** Spending is a metering event that goes to ClickHouse. Two
requests that both consume the last credit will both be recorded, and the balance will simply go
into overage. The classic race is not solved. It is avoided by making spending asynchronous and
allowing the balance to go past zero.

The access check confirms this. `HasAccess` at `openmeter/entitlement/metered/connector.go:60-66` is
just:

```go
func (m *MeteredEntitlementValue) HasAccess() bool {
    if m.isSoftLimit {
        return true
    }
    return m.Balance > 0
}
```

A read of a computed balance, with no reservation attached. It is a check, not a check-and-take. For
a metered API product that is fine, because a small overshoot costs the vendor almost nothing. For
us it is not fine, because a runaway agent loop can burn a lot of model spend in the seconds between
two reads.

### The new ledger: advisory locks

OpenMeter has since built a second, separate system for money, and it locks differently. The lock
helper is `pkg/framework/lockr/locker.go:65-89`:

```go
rows, err := client.QueryContext(ctx, "SELECT pg_advisory_xact_lock($1)", int64(key.Hash64()))
```

That is a Postgres transaction-scoped advisory lock, meaning a named lock that is released
automatically when the transaction ends. `LockAccountsForPosting`
(`openmeter/ledger/account/service/service.go:116-160`) collects the affected customer accounts,
**sorts them by namespace then ID**, and takes the locks in that sorted order. Sorting is how you
avoid deadlock when two transactions need the same two accounts.

That is the pattern to copy if we ever lock more than one account at a time.

## Costs that are unknown until the work finishes

OpenMeter does not handle this. There are no holds, no reservations, and no authorizations in the
credit engine. I searched the whole credit, entitlement and ledger tree for those words and the only
matches are comments in the ledger's collector about reserving from multiple source buckets during a
single collection, which is a different idea (`openmeter/ledger/collector/collection_fbo.go:249-250`).

Their answer to "the amount was larger than the balance" is overage. The engine tracks it as a
separate positive number that flows from segment to segment
(`openmeter/credit/engine/run.go:170` and `:237-241`), and it is reported to the customer as a field
on the balance (`openmeter/entitlement/metered/balance.go:31` and `:102`). Balances themselves never
go negative. `burnDownGrants` sets a drained grant to exactly 0 rather than to a negative number, and
the comment says why: "0 usage to avoid arithmetic errors"
(`openmeter/credit/engine/run.go:293`).

There is one deliberate softness that is relevant to us. An entitlement can be marked `IsSoftLimit`,
documented at `openmeter/entitlement/metered/entitlement.go:32-34` as "By default when balance falls
to 0 access will be disabled. If this is a soft limit, access will be allowed nonetheless". So the
product decision about what to do at zero is a per-entitlement flag, not a hardcoded rule. That is a
good idea and it is cheap.

The gap is real and it is ours to fill. Nothing in OpenMeter tells us how to reserve an unknown
amount before a model call and correct it afterwards.

## What else the design carries

**Expiry.** Two columns. `expiration` holds a rule as JSON, for example `{"count": 12, "duration":
"MONTH"}`, and `expires_at` holds the resolved timestamp so queries can use an index. The resolution
is 25 lines of date arithmetic at `openmeter/credit/grant/expiration.go:14-29`. `expires_at` is
exclusive: the grant is active at that instant and inactive after it
(`openmeter/credit/grant/grant.go:39-41`). Expiry is not a background job. It falls out of the
active-period check `ActiveAt` (`openmeter/credit/grant/grant.go:108-110`), so a grant stops
counting the moment the clock passes it, with no worker involved.

**Voiding and clawback.** `VoidGrant` writes `voided_at` and nothing else
(`openmeter/credit/adapter/grant.go:75-81`). The effect comes from
`GetEffectivePeriod` (`openmeter/credit/grant/grant.go:76-106`), which clamps the grant's active
window to end at the earlier of expiry, deletion and void. During replay, a grant that is not active
at the start of a phase has its balance forced to zero
(`openmeter/credit/engine/run.go:200-204`).

Read that carefully, because it decides what a clawback means. Voiding **removes the unspent
remainder going forward. It does not reverse credits already consumed.** If someone was rewarded 500
credits for an article, spent 300, and we then void the grant, they keep the benefit of the 300 and
lose the 200. If we want a true clawback we have to add a negative entry, and OpenMeter has no
concept of one. In fact `ListActiveGrantsBetween` explicitly filters out negative amounts, with the
comment "For a time we allowed negative grant amounts with an undefined behavior, for continuity we
just silently ignore them" (`openmeter/credit/adapter/grant.go:214`).

**Different kinds of credit spent in a defined order.** Covered above. It is the `priority` column
plus `PrioritizeGrants`.

**Negative balances.** Not possible. Overage instead.

**Rollover across a period reset.** Two columns, `reset_max_rollover` and `reset_min_rollover`, and
one formula at `openmeter/credit/grant/grant.go:124-128`:
`min(max_rollover, max(min_rollover, ending_balance))`. Setting both to zero means "use it or lose
it". Setting max to a large number means "everything carries over". Setting min equal to the grant
amount means "top back up to full every period". One formula covers all three product behaviours,
which is a nice piece of design.

**Recurrence.** A grant can refill itself on a schedule, using an ISO 8601 duration and an anchor
(`openmeter/ent/schema/grant.go:54-55`). On each recurrence the balance is set back to the full
amount, with no rollover applied (`openmeter/credit/grant/grant.go:113-121`). This is the mechanism
behind "1,000 credits every month" without writing a new grant row each month.

**Reconciliation against an outside source.** Absent from the credit engine. The newer ledger has an
account type called `wash` described as "the external payment or cash boundary"
(`openmeter/ledger/README.md`), which is where reconciliation would attach, but there is no
reconciliation job in the credit code.

**Precision.** The balances are `float64` in Go, even though the columns are `numeric` in Postgres.
There is a standing FIXME about it at `openmeter/credit/engine/run.go:274`: "calculations happen on
inexact representations as float64, this can lead to rounding errors". The burn function converts to
a decimal type for the subtraction and then converts back
(`openmeter/credit/engine/run.go:278-308`), which reduces but does not remove the problem. Do not
copy this.

**Time quantisation.** The whole system is snapped to one-minute buckets, because that is the
metering window. `effective_at` is truncated on create (`openmeter/credit/grant.go:67-68`), activity
change times are truncated (`openmeter/credit/engine/grant.go:47-49`), snapshots must be aligned
(`openmeter/credit/helper.go:247-249`), and read times are rounded up to the next minute
(`openmeter/credit/balance.go:135-137`). Several of these carry `FIXME: remove truncation` comments.
This is inherited complexity from ClickHouse windowing and we should not inherit it.

## The burn-down history API

`GetEntitlementBalanceHistory` (`openmeter/entitlement/metered/balance.go:109-373`) returns two
parallel views, packaged by the public schema `WindowedBalanceHistory` at `api/openapi.yaml:26537`.

The first view is a windowed usage series: one row per hour or per day, each with usage in that
window, balance at the start, and overage at the start. Window size is limited to hour or day
because minute precision "results in an extremely heavy calculation"
(`openmeter/entitlement/metered/balance.go:49-53`).

The second view is the burn-down history proper. Each segment is one stretch of time in which the
burn order did not change. The public shape is `GrantBurnDownHistorySegment` at
`api/openapi.yaml:18454-18516`, and it contains: the period, total usage in it, overage, the total
balance at the start and at the end, the per-grant balance map at the start and at the end, and a
list of grant usage records saying which grants were burned and by how much
(`GrantUsageRecord`, `api/openapi.yaml:18555-18571`).

The internal structure also records **why** the segment ended. `SegmentTerminationReason`
(`openmeter/credit/engine/history.go:15-19`) has three fields: the priority order changed, a list of
grant IDs that recurred, and whether a usage reset happened. And each individual grant usage records
whether that grant ran out or whether the segment simply ended
(`openmeter/credit/engine/history.go:23-26`).

### Is it enough to answer a customer asking why their balance is what it is?

Partly. It answers the *allocation* question completely. A customer can see that on Tuesday their
promotional grant ran dry, that spend then moved to their purchased grant, and that 40 units went
uncovered. Every number reconciles, because the same engine run produced the balance and the
history.

It does not answer the *attribution* question at all. There is no link from a burn to the thing that
caused it. A segment says "grant X lost 220 units between 09:00 and 11:00". It cannot say which
requests those were. To find that out the customer has to go to the raw events, which live in a
different system with a different API.

For us this is decisive. A person whose free credits vanished in ten minutes will ask "which agent
run did this", not "which lot did it come out of". A segment-level history does not answer that. We
need a per-charge record, and we need it from day one, because backfilling attribution is impossible
after the fact.

## The second system OpenMeter built, and why that matters

Since the credit engine, OpenMeter has added a full double-entry ledger under `openmeter/ledger/`.
It is 100 or so Go files with its own README. Double entry means every movement writes at least two
rows that sum to zero, so moving 10 credits from a customer balance to recognised earnings writes
minus 10 in one place and plus 10 in the other, and the check that they sum to zero catches bugs.

Its README states the model plainly: "The historical ledger stores immutable transaction groups,
transactions, and entries. Balances are projections over those entries; they are not mutable facts
stored independently from the journal" (`openmeter/ledger/README.md`).

The entry table (`openmeter/ent/schema/ledger_entry.go:28-60`) is small: a sub-account, an amount as
`numeric`, a transaction ID, an identity key, a schema version, and optional links to the charge that
sourced the value and the charge that spent it. Every field is immutable. Balance is a `SUM` over
those rows (`openmeter/ledger/historical/adapter/ledger.go:260-290`).

Two details are worth stealing outright.

The uniqueness constraint at `openmeter/ent/schema/ledger_entry.go:91`:
`index.Fields("transaction_id", "sub_account_id", "identity_key").Unique()`. That is a database-level
guarantee that the same logical leg cannot be posted twice inside a transaction.

And an unusually honest warning in the README: "The historical ledger makes a group atomic, but it
does not deduplicate a repeated `CommitGroup` call. The initiating domain must make retries safe and
persist the returned group reference with its own lifecycle state. Ledger annotations and entry
identity preserve accounting meaning and provenance; they are not operation idempotency keys."
Atomicity is not idempotency. We will need our own key at the gateway, above whatever the ledger
gives us.

The headline finding is the shape of the story. OpenMeter started with a computed-from-metering
credit engine, found it did not cover money, and built a second immutable-entry ledger beside it.
They now run both. We should not repeat that sequence. We should start with the entry ledger and
borrow the grant model into it.

## What can be lifted into Python and Postgres

Most of it, and more easily than I expected.

The pure engine is six files and roughly 1,090 lines of Go:

| File | Lines | What it does |
| --- | --- | --- |
| `openmeter/credit/engine/engine.go` | 96 | Types and the `Run` contract |
| `openmeter/credit/engine/run.go` | 313 | Replay loop and `burnDownGrants` |
| `openmeter/credit/engine/grant.go` | 229 | `PrioritizeGrants` and activity-change detection |
| `openmeter/credit/engine/history.go` | 234 | Burn-down history structures |
| `openmeter/credit/engine/burnphase.go` | 160 | Cutting a window into phases |
| `openmeter/credit/engine/reset.go` | 57 | Rollover and overage carry at a period reset |

Add the two small support packages, `openmeter/credit/balance/balance.go` (97 lines) and
`openmeter/credit/grant/grant.go` (142 lines) plus `expiration.go` (53 lines), and the whole thing
is under 1,400 lines.

I checked the imports of every non-test file in that package. They pull in only three OpenMeter
packages: `credit/balance`, `credit/grant`, and `pkg/timeutil` for date arithmetic, plus
`openmeter/meter` for a single enum comparison against `MeterAggregationLatest`. Zero ClickHouse.
I confirmed with a grep across the whole `openmeter/credit/` tree: the string "clickhouse" appears 0
times.

ClickHouse enters only through the function pointer `QueryUsageFn`. In our port that function is
replaced by a Postgres query, or, if we write debit rows, by reading them.

Two things do have to change on the way across.

Replace `float64` with Python's `Decimal` mapped to Postgres `numeric`. OpenMeter's own FIXME tells
us this.

Drop the one-minute quantisation everywhere. It exists to match ClickHouse metering windows and it
carries several `FIXME: remove truncation` comments in OpenMeter's own source.

The Go tests are also worth porting. `openmeter/credit/engine/run_test.go` is 1,104 lines of table
driven cases with names that read as a specification: "Burns down grant with higher priority first",
"Burns down grant that expires first among many", "Burns down grant until it's voided". Translating
those tables into pytest gives us a conformance suite for free.

## One more thing they built that we will need

`openmeter/llmcost/` is a small package that stores per-model token prices. `ModelPricing` at
`openmeter/llmcost/llmcost.go:36-51` has five fields: input per token, output per token, cache read
per token, cache write per token, and reasoning per token.

That last set matters for us more than for them. Our harness replays roughly 23,600 tokens of
context on every model call, and one user message with tool use typically causes two or three calls.
Prompt caching, meaning the provider charging less for a repeated prefix, is our biggest cost lever.
A price table that has only one input rate cannot express the difference between a cached and an
uncached prefix, and would misprice us by a large factor.

OpenMeter also separates prices by origin, with a `PriceSource` of either `manual` (an override
someone typed) or `system` (a reconciled global price produced by a sync job)
(`openmeter/llmcost/llmcost.go:13-21`), and there is a whole `openmeter/llmcost/sync/` directory
that fetches and reconciles prices from an outside source. That is a good structure and it is small.

## Judgment for our situation

### Copy directly

**The grant row.** An immutable row with amount, priority, effective_at, expires_at, optional
metadata, and a nullable voided_at. No remaining-amount column. This is the whole credit-lot model
and it costs one table.

**The three-key burn order.** Priority ascending, then soonest expiry, then oldest creation with the
ID as a final tie break. Verified by their tests and by ours once we port them. Our three sources map
onto it with no extra machinery: signup grant at priority 1, contribution earnings at 2, purchases at
3.

**Void by writing a timestamp.** Never delete a grant. Write `voided_at` and let the read path clamp
the grant's active window. Understand what it means: the unspent remainder disappears, already-spent
credits are not reversed. If we want a true clawback for a reversed contribution reward, that is a
separate negative entry and we should decide it deliberately.

**The snapshot as a cache with a soft-delete invalidation.** The row shape (`owner_id`, `at`,
per-grant JSON map, total, overage) and the read query ("latest row at or before T where deleted_at
is null") are both right. So is the single-statement invalidation. Most importantly, copy the rule
that **a snapshot is only a cache**: if you cannot get the lock to write one, skip it.

**The no-wait lock for cache writes and the blocking lock for real writes.** Two lines of difference,
and it means reads never queue behind each other.

**Sorted lock acquisition.** From the newer ledger. If a write ever touches more than one account,
sort the identifiers and lock in that order.

**The partial unique index for idempotency keys.** `UNIQUE (organization_id, key) WHERE key IS NOT
NULL AND deleted_at IS NULL`. Their comment explains both halves of the predicate.

**The soft-limit flag.** What happens at zero balance should be a per-organization setting, not a
constant in the code. We will want to let a specific customer keep running while we sort out a
payment.

**The burn-down history segment as an API response shape.** Period, usage, overage, per-grant
balances at start and end, list of grants burned with amounts, and a reason the segment ended. It is
a good answer to "explain my balance", as far as it goes.

**The five-way LLM price table.** Input, output, cache read, cache write, reasoning, with a
manual-versus-synced source flag.

### Simplify

**Write debit rows. This is the one big departure.** OpenMeter can recompute usage from ClickHouse
at any time, so it never needs to record a charge. We cannot and should not build that. So our
ledger stores entries, and the balance is a `SUM` over entries, exactly as OpenMeter's own newer
ledger does. The grant model rides on top: each debit records which grant or grants it came out of.

Concretely, the smallest shape that does not need an ugly migration later is three tables.

```
credit_grants        -- OpenMeter's grant row, near enough verbatim
credit_entries       -- append only; one row per movement
credit_allocations   -- which grant a debit came out of, and how much
```

A debit of 12 credits that drains the last 5 of a promotional grant and takes 7 from a purchased one
writes one `credit_entries` row and two `credit_allocations` rows. The allocation rows are the
per-charge equivalent of OpenMeter's `GrantUsage` records, and they are what makes the burn-down
history answerable per request rather than per segment.

**Then most of the engine disappears.** Burn phases, recurrence, resets, rollover and usage periods
exist in OpenMeter because usage arrives as an aggregate over a window and the engine has to work
out what the order was at each instant inside that window. If a debit records its own allocation at
the moment it happens, there are no phases to reconstruct. What survives is `PrioritizeGrants` and
`burnDownGrants`, which together are under 80 lines.

**Keep the snapshot idea but make it cheaper.** With entry rows, a snapshot is just "as of entry ID
N, each grant had this much left". Invalidation is still a soft delete of snapshots after a time,
and it is still triggered only by a grant insert or a void.

**Drop the minute quantisation.** It is ClickHouse's constraint, not ours.

**Use `Decimal` and `numeric`.** Do not carry over the `float64` FIXME.

**Do not build recurrence in version one.** A monthly refill is a scheduled job that inserts a new
grant row. That is one cron entry against 90 lines of recurrence iteration in the engine, and the
grant table already supports it with no schema change.

### Do not copy

**The metering-based architecture.** Computing balance by re-querying an analytical store is correct
and elegant, and it assumes ClickHouse. Adopting it would mean adopting ClickHouse, or writing a
usage store in Postgres that would end up looking like an entry table anyway.

**Check-without-take.** `HasAccess` reads a computed balance and returns a boolean. Between that read
and the spend there is no reservation. For a metered API that is fine, because a small overshoot is
cheap. For us it is not, because the party spending our money is running instructions the user wrote,
so a runaway loop is a normal event rather than an attack. Two concurrent requests for the last of a
balance must not both succeed.

The good news is that we already have the right pattern in our own codebase. The metering DAO at
`api/ee/src/dbs/postgres/meters/dao.py:465-518` does an atomic check-and-consume in one statement:

```python
insert(MeterDBE)
    .values(..., value=desired_value, synced=0)
    .on_conflict_do_update(
        index_elements=[MeterDBE.meter_id],
        set_={"value": func.greatest(MeterDBE.value + meter.delta, 0)},
        where=where,                 # e.g. value + delta <= quota.limit
    )
    .returning(MeterDBE.value)
```

If no row comes back, the write was refused because the limit would have been crossed
(`api/ee/src/dbs/postgres/meters/dao.py:506-508`). The condition is evaluated inside the same
statement that applies the change, so two concurrent callers cannot both pass. That is precisely the
guarantee OpenMeter's credit engine does not give, and we already have it. Our credit spend path
should use the same shape, either as a conditional update against a cached balance column or as a
`SELECT ... FOR UPDATE` on the organization row before inserting the debit.

**Overage as the answer to running out.** OpenMeter lets usage exceed grants and records the excess.
That is right for a vendor who will invoice the difference. It is wrong for a free tier funded from a
fixed pool of cloud credit, where the excess is money we never get back. We want refusal at zero,
with the soft-limit flag as the deliberate exception.

**Usage periods, resets and rollover in version one.** These bring the retroactive-grant restriction
with them, and retroactive granting is a headline feature for us. Someone publishes an article, we
review it a week later, and we credit them as of the publication date. OpenMeter cannot do that, and
the only reason it cannot is that a period reset may already have computed a rollover. Leave periods
out and backdating is free.

**Segment-level history as the only explanation.** It cannot say which agent run spent the credits.
Add per-charge attribution from the start.

### What OpenMeter does not solve for us

Two gaps remain after all of this, and both belong to the gateway rather than the ledger.

**The unknown cost.** OpenMeter has no holds. We need them, because we learn the token count only
when the response completes. The cheap first version is a two-phase entry: insert a debit row with a
status of `pending` and an estimated amount before forwarding the call, then update the amount and
set the status to `settled` when the response returns. Available balance becomes the sum of settled
entries minus the sum of pending ones. Two facts make this cheap. The estimate does not have to be
good, only conservative. And a crashed gateway leaves a stale pending row, which a sweeper expires
after a timeout. Putting a `status` column and an `amount` that can be corrected on the entry row
from day one is what makes this a later feature rather than a later migration.

**The two-system failure.** A hold written in our database and a call sent to the provider are two
writes to two systems. If the provider call succeeds and our settlement write fails, we have served
work we did not charge for. OpenMeter has nothing to say about this, and neither does any ledger
project. It is a gateway design problem and it needs its own decision.

## Summary table

| Question we asked | OpenMeter's answer | Verified at |
| --- | --- | --- |
| What is the grant table? | Immutable row: amount, priority, effective_at, expires_at, rollover bounds, optional recurrence, nullable voided_at. No remaining column. | `openmeter/ent/schema/grant.go:28-64` |
| What is in a snapshot row? | owner, `at`, per-grant remaining balances as JSON, total, overage, usage since period start, unit regime stamp. | `openmeter/ent/schema/balance_snapshot.go:27-59` |
| When is a snapshot taken? | As a side effect of a balance read, only for segment boundaries older than the later of (now minus grace period, default one day) and the current period start, and only if a no-wait lock is free. | `openmeter/credit/helper.go:200-240`, `openmeter/credit/connector.go:52-60` |
| What invalidates a snapshot? | One statement that soft deletes every snapshot after a time. Called only on grant create and grant void. | `openmeter/credit/adapter/balance_snapshot.go:28-40` |
| What about a grant backdated behind a snapshot? | Rejected if it predates the current usage period. Within that period, allowed, and the snapshots after it are invalidated. | `openmeter/credit/grant.go:77-79`, `:109-113` |
| How is a usage event made idempotent? | Not in the credit engine. Redis `SET NX` with a TTL, keyed on namespace plus CloudEvents ID plus source. Best effort. | `openmeter/dedupe/dedupe.go:33-41`, `openmeter/dedupe/redisdedupe/redisdedupe.go:78-100` |
| What protects two concurrent burns? | Nothing, because there is no synchronous burn. Writes take `SELECT ... FOR UPDATE` on the entitlement row; spending is an async metering event and simply produces overage. | `openmeter/entitlement/adapter/entitlement.go:850-874`, `openmeter/entitlement/metered/connector.go:60-66` |
| How are voided grants handled? | Write `voided_at`; the active window clamps to it; the unspent remainder goes to zero. Already-spent credits are not reversed. Negative grant amounts are ignored. | `openmeter/credit/grant/grant.go:76-106`, `openmeter/credit/adapter/grant.go:214` |
| How much lifts into Python and Postgres? | The whole engine, about 1,400 lines, with zero ClickHouse imports. Usage enters through one function pointer. | `openmeter/credit/engine/engine.go:78`; grep for "clickhouse" under `openmeter/credit/` returns 0 |
| Is the burn-down history enough to explain a balance? | It explains which lot was drained and when. It cannot say which request caused it. | `api/openapi.yaml:18454-18516` |
