# TigerBeetle: how its ledger works, and what of it to copy into Postgres

## What this document is

TigerBeetle is a database that does one thing: double entry accounting. It is written in Zig,
licensed Apache 2.0, and it has an independent Jepsen audit, which almost no project in this space
has. We are not going to run it. It is a separate database aimed at millions of transfers per
second on a single machine, which is several orders of magnitude above anything we need, and it
would be a second stateful service in a stack that is already docker compose on one EC2 host.

We are going to read it. TigerBeetle is the clearest public statement of the exact primitive our
gateway needs: reserve an amount before doing work whose cost you do not yet know, then settle for
the true amount and release the rest. Every rule it enforces is a rule we would otherwise discover
in production, one incident at a time. This document maps the data model, the resolution rules, the
error codes, the concurrency mechanism, and the audit findings, and then says which parts to copy
into Postgres, which to simplify, and which to leave behind.

Repository: https://github.com/tigerbeetle/tigerbeetle. Apache 2.0. Every file path and line number
below refers to commit `97c7a8ef385270ebe0e1b75959d3d21d134629df`, whose latest release entry in
`CHANGELOG.md` is TigerBeetle 0.17.9, released 3 July 2026. Primary documentation:
https://docs.tigerbeetle.com/coding/two-phase-transfers/.

## The terms used in this document

A **ledger** here means two things at once, so it is worth separating them. In the general sense, a
ledger is a list of entries that only grows, from which you derive a balance. In TigerBeetle's own
vocabulary, `ledger` is also a field: an integer that names a currency or a unit, for example one
integer for US dollars and another for request counts. Two accounts can only transfer between each
other if their `ledger` fields match. When the field is meant, this document says "the `ledger`
field".

An **account** is a record holding four running totals. A **transfer** moves an amount from one
account to another. Money leaving an account is a **debit**, money arriving is a **credit**. Every
transfer writes both sides at once, which is what makes the books balance.

A **pending transfer** is a hold. It reserves an amount without moving it. Your card at a gas pump
is the everyday version: the station holds a round number before you pump, because nobody knows the
final amount yet. **Posting** a pending transfer settles it for a real amount. **Voiding** it
cancels it and gives the reservation back. **Expiring** is what happens when nobody posts or voids
before the deadline.

**Idempotency** means that sending the same write twice applies it once. TigerBeetle achieves it
with a caller-chosen identifier on every transfer.

A **flag** in TigerBeetle is one bit in a 16 bit field on the account or the transfer record. Flags
are how the database is configured per record instead of per deployment.

## The data model

TigerBeetle has exactly two objects a user creates: accounts and transfers. Both are fixed size, 128
bytes each. There are two more record types the database maintains internally, and they matter to us
more than their obscurity suggests.

### The account record

From `src/tigerbeetle.zig:10-41`:

```zig
pub const Account = extern struct {
    id: u128,
    debits_pending: u128,
    debits_posted: u128,
    credits_pending: u128,
    credits_posted: u128,
    user_data_128: u128,
    user_data_64: u64,
    user_data_32: u32,
    reserved: u32,
    ledger: u32,
    code: u16,
    flags: AccountFlags,
    timestamp: u64,
};
```

The four amount fields are the whole balance model, and they are worth stating one at a time.

`debits_posted` is money that has actually left this account. `credits_posted` is money that has
actually arrived. `debits_pending` counts amounts reserved by holds that have not yet resolved, and
`credits_pending` counts reserved amounts on the receiving side. The two pending fields are not part
of the settled balance. They are the amount that a hold has taken out of circulation.

The available balance of an account that is only allowed to spend what it has received is
`credits_posted - debits_posted - debits_pending`. That formula is not written down as a field. It
is implied by the limit check, which we will get to.

`ledger` and `code` are integers, not strings. `ledger` names the unit. `code` is a chart of
accounts code, meaning a number that says what kind of account or what reason for a transfer. The
project's guidance is to keep the string names in your general purpose database and cache the
integer mapping in your API layer, and to never look the mapping up on the hot path
(`docs/coding/system-architecture.md`, the "Ledger, Account, and Transfer Types" section).

`user_data_128`, `user_data_64` and `user_data_32` are opaque. They exist so you can attach your own
identifiers, for example the id of a row in your own database, and then query transfers by them.

`timestamp` is the time the account was created, in nanoseconds since the Unix epoch, and the
cluster assigns it. The user must send zero.

Accounts cannot be deleted and their non-amount fields cannot be changed after creation
(`docs/reference/account.md`, "Updates" and "Deletion"). The amount fields are updated in place by
transfers. So the account row is mutable, but only in the four counters.

### The account flags

From `src/tigerbeetle.zig:43-66`, six flags are defined and ten bits are reserved as padding:

| Flag | What it does |
| --- | --- |
| `linked` | Ties this account's creation to the next one in the same request, so they succeed or fail together. |
| `debits_must_not_exceed_credits` | Refuses any transfer that would push this account's debits above its credits. This is the "cannot go negative" flag for an account that holds a balance. |
| `credits_must_not_exceed_debits` | The mirror image, for accounts that represent an obligation rather than a balance. Mutually exclusive with the flag above. |
| `history` | Keeps a copy of the four balance fields after every transfer that touched this account, so you can ask what the balance was at a past moment. |
| `imported` | Lets you supply your own timestamp when loading historical data. Used for migration only. |
| `closed` | Refuses all further transfers except voiding a hold that is still open. |

### The transfer record

From `src/tigerbeetle.zig:83-113`:

```zig
pub const Transfer = extern struct {
    id: u128,
    debit_account_id: u128,
    credit_account_id: u128,
    amount: u128,
    pending_id: u128,     // the hold this transfer resolves, or zero
    user_data_128: u128,
    user_data_64: u64,
    user_data_32: u32,
    timeout: u32,         // seconds until a hold expires; zero means never
    ledger: u32,
    code: u16,
    flags: TransferFlags,
    timestamp: u64,
};
```

Transfers are immutable and are never deleted. Resolving a hold does not modify the hold. It
inserts a second transfer that points at the first through `pending_id`
(`docs/coding/two-phase-transfers.md`, "All Transfers Are Immutable"). This is the single most
important structural decision in the whole design, and it is the one we should copy without
argument. Every event in the system is a new row. Nothing is ever edited.

### The transfer flags

From `src/tigerbeetle.zig:129-142`:

| Flag | What it does |
| --- | --- |
| `linked` | Chains this transfer to the next one in the request. All of them succeed or all of them fail. |
| `pending` | This transfer is a hold. It moves the amount into the pending fields, not the posted ones. |
| `post_pending_transfer` | This transfer settles the hold named by `pending_id`. |
| `void_pending_transfer` | This transfer cancels the hold named by `pending_id`. |
| `balancing_debit` | Treat `amount` as a maximum. Transfer as much as the debit account can afford, and record the actual amount. |
| `balancing_credit` | The same, bounded by the credit account instead. |
| `closing_debit` | Set the `closed` flag on the debit account. Only allowed on a pending transfer, so it can be undone by voiding. |
| `closing_credit` | The same for the credit account. |
| `imported` | Migration mode, as above. |

### The two internal record types

The first is `TransferPending`, at `src/state_machine.zig:92-102`:

```zig
pub const TransferPending = extern struct {
    timestamp: u64,
    status: TransferPendingStatus,   // none, pending, posted, voided, expired
    padding: [7]u8,
};
```

This is a tiny mutable row, keyed by the hold's timestamp, that records whether the hold is still
open. The hold's own transfer record never changes. The status lives beside it. That separation is
why "a hold can be resolved exactly once" is enforceable with a single comparison, and it is the
second thing we should copy directly.

The second is `AccountEvent`, at `src/state_machine.zig:104-220`. It is a 256 byte append only row
written on every transfer, holding both accounts' four balance fields as they stood immediately
after the event, plus the amount the client asked for, the amount actually applied, and the
resolution status. It is always written, so that a separate job can stream every change out to
another system, and it is indexed for lookup only when the account carries the `history` flag
(`src/state_machine.zig:4449-4463`). This is the balance history table, and it is the reason a stored
balance is auditable rather than a number you have to trust.

## How a balance is produced

TigerBeetle stores the balance. It does not recompute it from the transfer log on every read.

When a transfer is created, the code loads both account records, computes the new four fields, and
writes the account back in the same step as inserting the transfer
(`src/state_machine.zig:3931-3958`). Reading a balance is then a single record lookup, not a scan
and a sum.

The trade-off they accepted is explicit. The stored balance is a derived value, so it can in
principle drift from the transfer log. TigerBeetle buys back the safety in three ways. First, the
update and the insert happen inside one state machine step that either fully applies or fully rolls
back, so drift by half-application is impossible. Second, the append only `AccountEvent` row records
the balance after every single event, so any stored balance can be checked against the event stream.
Third, the documented cluster invariant is that the sum of all accounts' `debits_posted` equals the
sum of all accounts' `credits_posted`, and the same for the pending fields
(`docs/reference/account.md`, "Guarantees"). That is a whole-database check you can run and it will
catch any arithmetic bug.

The lesson for us is that "compute the balance by summing the entries every time" is not the
rigorous choice and "store the balance" is not the sloppy one. The rigorous choice is to store the
balance, write the entry in the same transaction, and keep the entries so you can prove the stored
number.

## How a charge is made safe against being applied twice

Idempotency in TigerBeetle is structural. Every transfer carries a 128 bit `id` that the caller
chooses, and the database enforces that at most one transfer exists per id.

The check is the first thing `create_transfer` does after validating the id is not a reserved value
(`src/state_machine.zig:3735-3739`):

```zig
switch (self.forest.grooves.transfers.get(t.id)) {
    .found_object => |e| return self.create_transfer_exists(t, &e),
    .found_orphaned => return .id_already_failed,
    .not_found => {},
}
```

If a transfer with that id already exists, the database does not write a second one. It compares the
new request field by field against the stored transfer and returns one of a family of results:
`exists` if they match, or `exists_with_different_amount`, `exists_with_different_flags`,
`exists_with_different_debit_account_id` and so on if they do not
(`src/state_machine.zig:3988-4051`). The documentation is blunt about how to use this: "To correctly
recover from application crashes, many applications should handle `exists` exactly as `created`"
(`docs/reference/requests/create_transfers.md`, the `exists` section).

The recommended discipline is that the client generates the id and persists it before sending
(`docs/coding/reliable-transaction-submission.md`). Then a lost request, a lost response, or a
client restart all resolve the same way: resend with the same id, get `exists`, move on.

There is a subtler rule that is easy to miss and that we should think about carefully. Failures are
split into two classes. A **permanent** failure, for example a malformed id, will fail the same way
forever. A **transient** failure depends on the state of the system at that moment. The list of
transient results is at `src/tigerbeetle.zig:322-336`: `debit_account_not_found`,
`credit_account_not_found`, `pending_transfer_not_found`, `exceeds_credits`, `exceeds_debits`,
`debit_account_already_closed`, `credit_account_already_closed`.

When a transfer fails with a transient result, TigerBeetle remembers the id as failed
(`src/state_machine.zig:3244-3250`):

```zig
// Transfers that fail with transient codes cannot reuse the same `id`,
// ensuring strong idempotency guarantees.
// Once a transfer fails with a transient error, it must be retried
// with a different `id`.
=> if (result_status.transient()) {
    self.forest.grooves.transfers.insert_orphaned_primary_key(id);
},
```

A retry with that same id then returns `id_already_failed`, forever, even after the underlying
problem is fixed. The reasoning is that an id must have exactly one outcome for all time. If a
transfer was refused because the balance was empty, and the same id could succeed an hour later
after a top-up, then the caller can no longer tell "my request was applied" from "my request was
applied and then something else happened". Committing to one outcome per id removes that ambiguity
completely.

## How concurrency is handled

This is the question where TigerBeetle's answer is the least transferable, and understanding why is
the point.

There is no lock anywhere in the accounting path, because there is no concurrency in the accounting
path. TigerBeetle runs one thread, on one core, on one leader node
(`docs/ARCHITECTURE.md:168-186`, `docs/concepts/performance.md:54-64`). Requests arrive in batches.
The replicas first agree on one fixed order for them, which is what consensus means here. The
database then executes them one event at a time, each to completion, before the next event starts
(`docs/concepts/safety.md:150-158`). The documented isolation level is strict serializability, which
means the result is always the same as if every request had run alone, one after another, in the
order the clients saw. It is the only isolation level offered.

So the classic failure, two requests arriving at once for the last of a balance, cannot happen by
construction. The two requests are ordered by the consensus log before the state machine ever sees
them. The first one reads the account, sees the balance, spends it, and writes the account back. The
second one reads the account afterwards and sees zero. The check itself is a plain comparison on a
record already in memory (`src/tigerbeetle.zig:33-36`):

```zig
pub fn debits_exceed_credits(self: *const Account, amount: u128) bool {
    return (self.flags.debits_must_not_exceed_credits and
        self.debits_pending + self.debits_posted + amount > self.credits_posted);
}
```

and it is called at `src/state_machine.zig:3903`, immediately before the comment "After this point,
the transfer must succeed."

Two things follow for us. The first is that we cannot copy the mechanism, only the rule. We run many
FastAPI workers against one Postgres, so we have real concurrency and we have to serialize the
read-check-write ourselves. The second is that the *shape* of the check is copyable and is the
important part: the balance test and the balance mutation must be one indivisible step, and the test
must include the pending amounts, not just the posted ones.

The good news is that we already have this pattern in the codebase. The existing metering system
does the whole thing in a single conditional statement: an `INSERT ... ON CONFLICT DO UPDATE SET
value = greatest(value + delta, 0) WHERE <limit predicate> RETURNING`, so the limit check happens
inside SQL and concurrent requests cannot jointly overshoot
(`prior-work/original-research.md`, section 3, citing `api/ee/src/dbs/postgres/meters/dao.py`). The
same trick expressed as an account update is in the recommendation section below.

We will pay one cost that TigerBeetle does not, and it is deadlock. A transfer touches two account
rows. Suppose one request locks account A and then wants B, while another request holds B and wants
A. Neither can proceed. Postgres notices and kills one of them. The fix is a discipline rather than a
feature. Inside a transaction, always update account rows in a fixed order, for example ascending by
id, so a cycle cannot form.

## How TigerBeetle handles a cost that is unknown until the work finishes

This is the reason TigerBeetle is on the shortlist. The sequence is two transfers.

**Step one, reserve.** Create a transfer with the `pending` flag. The amount goes into
`debits_pending` on the payer and `credits_pending` on the receiver. The posted fields are untouched
(`src/state_machine.zig:3925-3934`).

**Step two, resolve.** Create a *second* transfer with `post_pending_transfer` or
`void_pending_transfer` set and `pending_id` pointing at the first. Its own `id` must be different
from the hold's id.

The settlement arithmetic is the detail that matters most to us
(`src/state_machine.zig:4241-4252`):

```zig
dr_account_new.debits_pending -= p.amount;
cr_account_new.credits_pending -= p.amount;

if (t.flags.post_pending_transfer) {
    assert(amount_actual <= p.amount);
    dr_account_new.debits_posted += amount_actual;
    cr_account_new.credits_posted += amount_actual;
}
```

The whole reservation comes out of the pending fields, and only the settled amount goes into the
posted fields. The difference is released automatically. There is no third transfer to write and no
remainder to track. That is precisely the shape of a model call: reserve the worst case, settle the
true cost, get the rest back in the same operation.

The amount you pass when posting is interpreted as follows (`src/state_machine.zig:4115-4126`,
documented at `docs/reference/transfer.md:143-158`):

- If `amount` is `AMOUNT_MAX`, which is `2^128 - 1`, the full held amount is posted.
- If `amount` is less than or equal to the held amount, that amount is posted and the rest is
  released.
- If `amount` is greater than the held amount but not `AMOUNT_MAX`, the transfer is refused with
  `exceeds_pending_transfer_amount`.
- Posting zero is legal. The test suite covers it at `src/state_machine_tests.zig:1426-1428`: a post
  of amount `0` returns `created` and settles nothing. So "the call failed and cost nothing" is
  expressible as a post, not only as a void.

Voiding is stricter. The amount must either be zero, meaning "use the held amount", or exactly equal
to the held amount. Anything else returns `pending_transfer_has_different_amount`
(`src/state_machine.zig:4126-4128`). A void is all or nothing by design. Partial release is what
posting less is for.

### The complete resolution rules and their errors

The resolution path checks conditions in a fixed order, and the order is the precedence order of the
errors. This table is the reference we should implement against.

| Situation | Result | Where |
| --- | --- | --- |
| The same resolving transfer id is sent twice. This is checked before everything below it. | `exists`, or `exists_with_different_*` if a field changed | `state_machine.zig:3735-3739`, `4301-4383` |
| `pending_id` is zero, or equals the resolving transfer's own id | `pending_id_must_not_be_zero`, `pending_id_must_be_different` | `state_machine.zig:4076-4078` |
| Both `post` and `void` flags set, or either combined with `pending` or a balancing flag | `flags_are_mutually_exclusive` | `state_machine.zig:4066-4073` |
| A `timeout` is set on a resolving transfer | `timeout_reserved_for_pending_transfer` | `state_machine.zig:4079` |
| The referenced transfer does not exist | `pending_transfer_not_found`, which is a transient error, so that id can never be used again | `state_machine.zig:4081-4088` |
| The referenced transfer exists but is not a hold | `pending_transfer_not_pending` | `state_machine.zig:4092` |
| Supplied `debit_account_id`, `credit_account_id`, `ledger` or `code` is non-zero and disagrees with the hold | `pending_transfer_has_different_*` | `state_machine.zig:4100-4112` |
| Posting more than the held amount | `exceeds_pending_transfer_amount` | `state_machine.zig:4124` |
| Voiding an amount other than the held amount | `pending_transfer_has_different_amount` | `state_machine.zig:4126-4128` |
| The hold was already posted | `pending_transfer_already_posted` | `state_machine.zig:4135` |
| The hold was already voided | `pending_transfer_already_voided` | `state_machine.zig:4136` |
| The hold already expired, or its deadline has passed | `pending_transfer_expired` | `state_machine.zig:4137-4153` |

Two rows in that table deserve emphasis because they answer the "attempting to resolve twice"
question in two different ways.

If you retry the resolution with the **same resolving transfer id**, you get `exists`. That is the
network-retry case, and it is safe: your retry is recognized as your own earlier write. There is a
special allowance for posts, documented at `docs/reference/requests/create_transfers.md:169-173`: if
the original post settled less than the held amount, the retry must carry that same settled amount;
otherwise it may carry anything from the held amount upward, so a retry with `AMOUNT_MAX` after a
full post still returns `exists`.

If you resolve with a **different transfer id** against a hold that is already resolved, you get
`pending_transfer_already_posted` or `pending_transfer_already_voided`. That is a genuine
double-settlement attempt and it is refused.

### Timeout and expiry

A hold may carry a `timeout` in seconds. TigerBeetle stores an interval rather than an absolute
time, because clocks in a cluster disagree and the cluster's own clock is the only one it trusts
(`docs/coding/time.md` is the long version). The deadline is computed as the hold's timestamp plus
the timeout in nanoseconds.

Expiry is not evaluated on read. A background step called a pulse scans for holds whose deadline has
passed and expires them in batches (`src/state_machine.zig:4511-4620`). Expiring releases the
reservation from both pending fields and sets the status to `expired`. It never touches the posted
fields, so an expired hold moves no money at all.

There is one honest caveat left in the source, at `src/state_machine.zig:4149-4151`:

```zig
// TODO: It's still possible for an operation to see an expired transfer
// if there's more than one batch of transfers to expire in a single `pulse`
// and the current operation was pipelined before the expiration commits.
```

So the expiry sweep can lag. The system handles it by checking the deadline a second time on the
resolution path and refusing with `pending_transfer_expired` if it has passed, whether or not the
sweeper has caught up yet. Copy that double check. The sweeper is housekeeping, and the decision that
counts happens where the money moves.

## Balance limits: the "refuse the call when the balance is zero" check

An account with `debits_must_not_exceed_credits` refuses any transfer that would make
`debits_pending + debits_posted + amount` exceed `credits_posted`. The mirror flag,
`credits_must_not_exceed_debits`, refuses a transfer that would make
`credits_pending + credits_posted + amount` exceed `debits_posted`. The two flags are mutually
exclusive. The code is the two small functions quoted earlier at `src/tigerbeetle.zig:33-40`, and
the documentation states the same formulas at `docs/reference/account.md:191-205`.

A transfer that would breach the limit returns `exceeds_credits` (when the debit account's limit is
the one breached) or `exceeds_debits` (for the mirror case). Both are transient errors, so that
transfer id is recorded as failed and a retry has to use a new one.

Three properties of this check matter for our design.

**The check includes pending amounts.** An account with 100 credited, 70 already spent, and 50 held
will refuse a new hold, because 70 plus 50 already reaches the ceiling. The documentation calls this
a pessimistic pending transfer (`docs/coding/two-phase-transfers.md`, "Pessimistic Pending
Transfers") and it is the correct behavior. A hold is money you have promised away.

**The check runs when the hold is created, never when it settles.** Read the resolution path again:
there is no limit test anywhere in `post_or_void_pending_transfer`. The documentation states why. The
reservation is taken in a way that guarantees the second phase can never breach a limit, whether it
posts or voids, because posting settles at most what was already reserved. This is the property that
makes the whole model work for us: the refusal happens before we spend money, and settlement can
never be refused.

**There is a "spend what you can" mode.** With `balancing_debit`, the `amount` becomes a maximum and
the database transfers as much as the account can afford, recording the real amount on the transfer
(`src/state_machine.zig:3841-3853`). If the account is empty the transfer records zero rather than
failing. That is a different product decision from refusing the call, and we should choose
deliberately which one we want when a balance runs out mid-conversation.

There is also a documented pattern for "do this transfer only if the balance is at least X", which we
will not need in v1 but is worth knowing exists: a chain of three linked transfers where the first
is a hold for the threshold amount, the second voids it, and the third does the real work
(`docs/coding/recipes/balance-conditional-transfers.md`). The hold fails if the balance is short, and
because the three are linked, the real transfer fails with it.

## Linked chains, which make several transfers succeed or fail together

A request to TigerBeetle is a batch of independent events. By default each one succeeds or fails on
its own. Setting `flags.linked` on an event ties it to the next one. The chain ends at the first
event without the flag, and the whole chain either applies or none of it does
(`docs/coding/linked-events.md`).

The implementation is a rollback scope. `execute_create` opens a scope when a chain starts, and if
any member fails it discards the scope, which reverts every write the chain made so far, then marks
every member with `linked_event_failed` (`src/state_machine.zig:3032-3040` and `3113-3145`). The
scope covers all four record types at once (`src/state_machine.zig:2960-3001`).

Do we need this for a single call that debits both a model cost and a tool cost? No, and the reason
is a useful piece of understanding rather than a shortcut. Linked chains exist because TigerBeetle's
request protocol has no transaction boundary. A batch is a list of events, not a unit of work, so
atomicity across events has to be expressed inside the data model. Postgres already gives us
`BEGIN` and `COMMIT`. Two debits in one database transaction are already all-or-nothing. We should
write them that way and skip the concept entirely.

The one place the idea earns its keep is where we might later want it: spending down several grants
in a fixed order. TigerBeetle's answer to that is a chain of `balancing_debit` transfers, one per
source account, in priority order, bracketed by a control account that enforces the total
(`docs/coding/recipes/multi-debit-credit-transfers.md`, "Multiple Debits, Single Credit, Balancing
debits"). It takes six transfers to express. That is a fair signal of how much complexity ordered
grant consumption really costs, in any system.

## Refunds, expiry, credit types, negative balances, and reconciliation

**Refunds and corrections.** There is no update and no delete. A mistake is corrected by writing a
new transfer in the opposite direction, with a `code` that marks it as a correction and, by
convention, the same `user_data_128` as the original so the two can be found together
(`docs/coding/recipes/correcting-transfers.md`). The argument for this is worth repeating to
ourselves: the history should contain the original error, the moment it happened, and the moment it
was corrected. A corrected record loses all three.

**Expiry of grants.** TigerBeetle has expiry for holds only. It has nothing for "this grant of
credits expires at the end of the month". That is a product concern one layer above the ledger.

**Credit types that must be spent in a certain order.** Not supported natively. The idiomatic
expression is one account per source of credit, plus the linked balancing chain described above.
There is no concept of a lot inside the database.

**Negative balances.** All amounts are unsigned. A balance is never a signed number in a field. It is
a direction: an account holding value has more credits than debits, and an account representing an
obligation has more debits than credits (`docs/coding/data-modeling.md`, the debits versus credits
section). An account can go "negative" in the everyday sense only if it has no limit flag set, and
then it simply has more debits posted than credits posted.

**Fractional amounts.** Amounts are integers, always. The guidance is to map the smallest useful unit
to 1 and treat every amount as a multiple of it, for example cents for dollars
(`docs/coding/data-modeling.md:80-110`). Never floating point.

**Reconciliation against an outside record.** Inside the cluster, the rule that total debits equal
total credits is the self-check. For anything outside, TigerBeetle ships a separate job that streams
every transfer and every balance change to a message queue as it happens, using the AMQP protocol
that RabbitMQ speaks (`docs/operating/cdc.md`). Whoever reads that queue does the comparison against,
say, a provider invoice. TigerBeetle does not do it for you.

**Closing an account.** Setting `closing_debit` or `closing_credit` on a hold marks the account
closed, and voiding that hold reopens it (`docs/coding/recipes/close-account.md`). A closed account
refuses everything except voids of holds that are still open. That is a clean model for suspending an
organization without deleting anything, and it costs one flag.

## What the Jepsen audit actually found

The audit is at https://jepsen.io/analyses/tigerbeetle-0.16.11, against version 0.16.11. Jepsen
tested three to six node clusters in containers and on EC2, with process crashes, pauses, network
partitions, clock skew, and file corruption including bit flips, misdirected writes, and restored
snapshots. Workloads included single phase and two phase transfers, with account identifiers drawn
from a skewed distribution so that some accounts were far hotter than others, plus a dedicated
workload whose only job was to check that a duplicate write never applies twice.

Ten issues are listed. Grouped by where they live:

| Issue | What broke | Layer |
| --- | --- | --- |
| #2544 | A merge join across two indexes stopped scanning early, so queries filtering on more than one field silently returned incomplete results. Fixed in 0.16.17. | Query engine |
| #2495 | The Java client reused one mutable response object, so timestamps from one response overwrote another. Fixed in 0.16.14. | Client library |
| #2435, #2484 | The client crashed the host process, once on an uninitialized pointer and once when the server evicted its session. Fixed by 0.16.13. | Client library |
| #2681a, #2681b | A single flipped bit in padding bytes or in a superblock field tripped an assertion and the server refused to start. Fixed in 0.16.26. | Storage |
| #2745, #2758, #2763 | Three separate panics during version upgrades, including one where a node diverged from the cluster's checkpoint. Fixed or documented by 0.16.29. | Upgrade and consensus |
| #2739 | A ring shaped replication topology meant one paused node raised latency by three to five orders of magnitude. Improved in 0.16.30 and 0.16.43. | Consensus |
| #2767 | There was no documented safe way to replace a node that lost its disk. A `recover` command was added in 0.16.43. | Operations |
| #206 | Clients retry forever with no timeout, which turns a definite failure into an indefinite wait. Still open. | Client design |

The finding that matters most is what is absent. Jepsen reported no violation of strict
serializability and no violation of the accounting invariants. No transfer was lost, none was applied
twice, and no balance came out wrong. The report states that from 0.16.30 onward the findings were
consistent with TigerBeetle's claim of strong serializability. The dedicated idempotence workload
found no case where a duplicate write succeeded twice.

**Does this class of bug apply to a Postgres implementation of the same model?** Mostly no, and that
is the honest answer rather than a comfortable one. Nine of the ten findings are in layers we would
not be writing: a bespoke storage engine, a bespoke consensus protocol, a bespoke upgrade path, and
hand-written client bindings. Postgres has had those layers hardened for thirty years and we would
inherit them.

Two findings do carry over in spirit. The first is #2544, the incomplete query result. That is a bug
in *reading*, not in *writing*, and its analogue for us is real: a reporting query that misses rows
will produce a balance report that disagrees with the ledger. The defense is the same one TigerBeetle
uses internally, which is to check derived numbers against the raw entries, not to trust the query.
The second is #206, the client that retries forever. Our gateway will call the ledger under a request
deadline. If a ledger write hangs, we have to decide whether to fail the model call or let it through
unmetered, and that decision should be made deliberately in the design rather than by whatever the
HTTP client library defaults to.

The class of bug that the audit does not protect us against is the one we are most likely to write. It
is called a lost update. Two requests each read the balance, each see enough money, and each then
write their own new balance, so one of the two charges vanishes. TigerBeetle cannot have that bug
because it has no concurrency. We can, and avoiding it is the single thing our implementation must
get right.

## What to copy, what to simplify, what to leave

### Field by field: mirror or drop

| TigerBeetle field or flag | Our Postgres tables | Why |
| --- | --- | --- |
| `Account.debits_pending` | Mirror | The size of all open holds against this account. Without it there is no hold. |
| `Account.debits_posted` | Mirror | Credits actually spent. |
| `Account.credits_pending` | Mirror | The receiving side of open holds. Keeps the books balanced and makes the "total pending debits equals total pending credits" check possible. |
| `Account.credits_posted` | Mirror | Credits actually received, meaning grants plus purchases plus earnings. |
| `Account.flags.debits_must_not_exceed_credits` | Mirror, as a text column with two values | This is the refuse-when-empty rule. |
| `Account.flags.credits_must_not_exceed_debits` | Drop for now, keep the column shape | We have no account that represents an obligation yet. Adding the second value later costs nothing. |
| `Account.flags.closed` | Mirror, as a boolean | Suspending an organization without deleting anything. |
| `Account.flags.history` | Drop | We can replay entries. Revisit when we build the balance history table. |
| `Account.flags.imported`, `Account.flags.linked` | Drop | Migration mode and batch semantics we do not have. |
| `Account.ledger` | Keep a column, do not build the machinery | One unit for now. The column leaves the door open. |
| `Account.code`, `Account.user_data_*` | Replace with plain columns | `organization_id`, `kind`, and a `jsonb` reference column read better than integers. |
| `Transfer.id` | Mirror, as a `uuid` chosen by the caller | The whole idempotency story. |
| `Transfer.debit_account_id`, `credit_account_id`, `amount` | Mirror | The movement itself. |
| `Transfer.pending_id` | Mirror | Links a settlement to its hold. |
| `Transfer.timeout` | Replace with an absolute `expires_at` | TigerBeetle stores an interval because cluster clocks disagree. We have one Postgres and `now()` is authoritative, so an absolute time is simpler and easier to index. |
| `Transfer.flags.pending`, `post_pending_transfer`, `void_pending_transfer` | Mirror as one `phase` column | Three flags that are mutually exclusive are really one enumeration. |
| `Transfer.flags.linked` | Drop | Postgres transactions replace it. |
| `Transfer.flags.balancing_debit`, `balancing_credit` | Drop for v1 | This is "spend what you can afford" instead of "refuse". A product decision we have not made. |
| `Transfer.flags.closing_debit`, `closing_credit` | Drop for v1 | Suspension can be a plain update on the account. |
| `Transfer.code` | Mirror, as text | Always record why the entry exists. |
| `Transfer.timestamp` | Mirror, as `created_at` | |
| `TransferPending.status` | Mirror | The one mutable field in the whole design, and the guard against double settlement. |
| `AccountEvent` (the whole record) | Drop for v1, plan for it | The balance history table. |

### Copy directly

**One table of immutable entries, and never edit a row.** Every grant, purchase, earning, hold,
settlement and correction is an insert. A mistake is corrected by another insert.

**The four counters on the account.** `debits_pending`, `debits_posted`, `credits_pending`,
`credits_posted`. Do not collapse them to a single balance column. The whole hold mechanism lives in
the gap between pending and posted, and there is no cheap way to add the distinction later once code
has been written against one number.

**The separate mutable status row for a hold.** The hold's own entry stays immutable. A small side
row carries `pending`, `posted`, `voided` or `expired`. Resolving a hold means one conditional update
of that row, and the condition is what makes double settlement impossible.

**Settlement releases the whole reservation and posts the actual amount.** Not "post the difference".
Not "write a compensating entry for the remainder". Subtract the full held amount from the pending
counters, add the settled amount to the posted counters, in one statement pair.

**A caller-chosen id on every entry, unique.** The gateway generates it before it calls the provider
and reuses it on every retry.

**The limit check runs at hold time, includes pending amounts, and never runs at settlement time.**
This is the rule that makes the gateway safe. We refuse before spending money, and we can always
record what we spent.

**Integer amounts with a named unit.** Given that a single agent turn can cost about three cents and
a prompt playground call about twenty-five millionths of a dollar
(`prior-work/original-research.md`, section 4), cents are far too coarse. Store micro-dollars,
meaning millionths of a dollar, in a `bigint`. That is a range of roughly plus or minus nine trillion
dollars, and the small call above becomes 25 rather than 0.

**A `code` column on every entry saying why it happened.** Ours can be text rather than an integer,
since we are not chasing a million transfers a second, but the discipline of always recording the
reason is the same.

### Simplify

**Skip linked chains.** Use a Postgres transaction. Model cost and tool cost for one call are two
inserts and two account updates inside one `BEGIN` and `COMMIT`.

**Skip the rule that a failed id can never be reused.** TigerBeetle refuses to reuse an id that failed with a
transient error. It is the right rule for a bank. For v1 it is an extra table and an extra lookup on
every write, and our gateway will generate a fresh id per attempt anyway. Note the cost of adding it
later: it is a new table plus one lookup in the create path, with no change to any existing row. That
is an additive migration, not a painful one.

**Skip the balance history table in v1, but keep the entries that would rebuild it.** TigerBeetle
writes a full 256 byte snapshot of both accounts after every event. We can reconstruct a past balance
by replaying entries on the rare occasion somebody asks. Nobody will ask in the first months.

**Skip separate pools of credit.** Give each organization one balance account in v1 and record the
source of each grant on the grant entry itself. When "spend the promotional grant before the
purchased one" becomes a real requirement, add one account per grant and move the remaining balance
across with ordinary transfers. That is an additive change, and it is not free: any reporting written
against the single account will need revisiting.

**Skip the `ledger` field's full generality.** TigerBeetle needs it because it serves many currencies
at once. We need one unit, credits. Keep a column so that a second unit is possible later, but do not
build the machinery.

### Do differently, on purpose

**Let a settlement succeed after its hold expired.** TigerBeetle refuses this with
`pending_transfer_expired`, and that is correct for a bank: an expired authorization must not be
captured. It is wrong for us. If the hold expires while the model call is still running, the provider
has already charged us. Refusing to record the cost loses real money and hides it. Our rule should be
that an expired hold can still be settled, and the settlement is recorded as an ordinary debit even
if it drives the balance below zero. Alternatively, set hold deadlines long enough that this is rare,
and treat every occurrence as an alert. Either way the decision has to be explicit.

**Decide what happens when the true cost exceeds the hold.** TigerBeetle returns
`exceeds_pending_transfer_amount` and refuses. Again, our money is already spent. The design must
either guarantee the hold is always an upper bound, or provide a path to record the overshoot. The
first is achievable if the hold is computed from the model's maximum output tokens and the largest
possible input, and it is the cleaner option. The second is the safety net.

**Watch the interaction with prompt caching when sizing a hold.** Our harness replays roughly 23,600
tokens on every call. Priced as an uncached prefix, that is about five times the real cost of a
cached one. A hold sized on the uncached worst case will therefore reserve about five times what the
call actually costs, and a user with a small balance will be refused calls they could afford. The
ledger does not care, since a hold is just a number. The gateway's estimator does, and it should
price the cached prefix at the cached rate with a margin, not at the write rate.

### The schema this suggests

Concretely, three tables and one optional fourth. Written for Postgres, with our naming.

```sql
-- Mutable in the four counters only. Everything else is fixed at creation.
CREATE TABLE credit_account (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL,
    kind              text NOT NULL,   -- 'balance', 'consumption', 'funding'
    debits_pending    bigint NOT NULL DEFAULT 0 CHECK (debits_pending  >= 0),
    debits_posted     bigint NOT NULL DEFAULT 0 CHECK (debits_posted   >= 0),
    credits_pending   bigint NOT NULL DEFAULT 0 CHECK (credits_pending >= 0),
    credits_posted    bigint NOT NULL DEFAULT 0 CHECK (credits_posted  >= 0),
    -- 'none' or 'debits_must_not_exceed_credits'
    limit_rule        text   NOT NULL DEFAULT 'none',
    closed            boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Append only. Never updated, never deleted.
CREATE TABLE credit_entry (
    id                 uuid PRIMARY KEY,          -- chosen by the caller
    debit_account_id   uuid NOT NULL REFERENCES credit_account (id),
    credit_account_id  uuid NOT NULL REFERENCES credit_account (id),
    amount             bigint NOT NULL CHECK (amount >= 0),   -- micro-dollars
    -- 'single', 'hold', 'settle', 'release'
    phase              text NOT NULL,
    -- set on 'settle' and 'release' rows only
    hold_entry_id      uuid REFERENCES credit_entry (id),
    -- why: 'model_call', 'tool_call', 'sandbox_time', 'grant',
    --      'purchase', 'contribution', 'correction'
    code               text NOT NULL,
    reference          jsonb,                     -- trace id, request id, invoice id
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (debit_account_id <> credit_account_id)
);

-- One row per hold. The only mutable part of a hold.
CREATE TABLE credit_hold (
    entry_id      uuid PRIMARY KEY REFERENCES credit_entry (id),
    status        text NOT NULL CHECK (status IN ('pending','posted','voided','expired')),
    expires_at    timestamptz NOT NULL,
    resolved_by   uuid REFERENCES credit_entry (id),
    resolved_at   timestamptz
);
CREATE INDEX ON credit_hold (expires_at) WHERE status = 'pending';
```

The fourth table, for later, is the balance history: one row per entry carrying both accounts' four
counters afterwards. It is what makes "prove this balance" a query instead of an argument.

Placing a hold is then one transaction containing an insert into `credit_entry`, an insert into
`credit_hold`, and this update:

```sql
UPDATE credit_account
   SET debits_pending = debits_pending + :amount
 WHERE id = :debit_account_id
   AND closed = false
   AND (limit_rule <> 'debits_must_not_exceed_credits'
        OR debits_pending + debits_posted + :amount <= credits_posted)
RETURNING credits_posted - debits_posted - debits_pending AS available;
```

Zero rows returned means refused, and the transaction rolls back. That single statement is the
equivalent of TigerBeetle's `exceeds_credits` check, and its row lock is what replaces TigerBeetle's
single thread. It is the same shape as the `adjust` statement our metering system already uses, so
the pattern is proven in our own codebase.

Settling is the mirror, guarded so it can happen only once:

```sql
UPDATE credit_hold
   SET status = 'posted', resolved_by = :settle_entry_id, resolved_at = now()
 WHERE entry_id = :hold_entry_id AND status = 'pending'
RETURNING entry_id;
```

Zero rows means the hold was already resolved, which maps to TigerBeetle's
`pending_transfer_already_posted`. When it does return a row, update both accounts by subtracting the
full held amount from the pending counters and adding the settled amount to the posted counters, all
inside the same transaction.

## The two options, priced honestly

### Option A: copy the model into Postgres

The build is three tables, one background sweeper that expires stale holds, and roughly four
statements: place a hold, settle a hold, release a hold, and record a single-phase entry. Everything
runs inside our existing FastAPI request handlers and inside our existing database transactions. As a
rough size, that is one migration, a few hundred lines of Python behind four functions, and a test
suite whose hard part is the concurrency test,
including the tests, and treat that as an estimate rather than a measurement.

The real cost is getting the concurrency right and proving it. The test that matters spins up many
concurrent workers racing for the last unit of one balance and asserts that exactly one of them wins.
Budget for that test specifically, because it is the one thing the design cannot survive getting
wrong.

There is a benefit here that is easy to miss. The gateway's own record of a request and the ledger's
hold would commit in the same database transaction. That closes part of the failure the shortlist
named as unsolved by every project we looked at, namely a hold placed in one system while a call is
sent from another, with either side free to fail in between. If both live in Postgres, that half of
the problem disappears. The other half remains: the provider call can succeed while our settlement
write fails. The hold itself contains that damage, because an unsettled hold expires, the reservation
comes back, and the gap shows up in a report as money we reserved and never spent.

What we give up is throughput far beyond anything we need, plus a storage layer that has been
formally verified. We would be inheriting Postgres's storage layer instead, which is not a bad trade.

### Option B: run TigerBeetle as a second datastore

The facts that price this:

- The project's own documentation says running it in Docker "is not recommended", because it ships as
  one static binary and Docker adds complexity for little gain (`docs/operating/deploying/docker.md`,
  lines 1 to 7).
- A replica needs at least 6 GiB of RAM, and 16 to 32 GiB is recommended for caching. ECC memory is
  listed as required for production, and local NVMe is strongly recommended
  (`docs/operating/hardware.md`). On one EC2 host with docker compose, we would run a single replica,
  which means no fault tolerance at all, which is most of what TigerBeetle is for.
- It has no authentication of any kind, so it must never be reachable from anything untrusted
  (`docs/coding/system-architecture.md`, "Authentication"). Given that our sandboxes run user-written
  agent instructions, this is a network boundary we would have to get right.
- Its identifiers are 128 bit integers and its metadata fields are small integers, so we would keep a
  Postgres table mapping our organizations, our reasons, and our request references anyway.
- Writes to it cannot join a Postgres transaction. Every ledger write becomes a second write to a
  second system, which is exactly the failure boundary we are trying to reduce.
- A Python client exists and installs with `pip install tigerbeetle` (`src/clients/python/README.md`),
  so the language is not the obstacle.
- Backups become a raw data file rather than the Postgres backups we already run, and until 0.16.43
  there was no documented way to replace a node that lost its disk (Jepsen #2767).

The scale case for it does not exist for us. TigerBeetle is built for millions of transfers per
second. A funded free tier generating two or three model calls per user message, even at a rate we
would be delighted by, is a few transfers per second.

### The recommendation

Copy the model into Postgres. TigerBeetle's value to us is its specification, not its binary. The
account fields, the hold and settle arithmetic, the resolution rules, the list of errors, and the
insistence that entries are immutable can all be built in tables we already know how to operate. The
one thing TigerBeetle has that we cannot copy is serial execution with no locks, and a single
conditional `UPDATE` replaces it. Our metering system already runs that exact shape in production.

Treat the resolution table above as the acceptance criteria for the hold implementation. Those rules
cost TigerBeetle years to arrive at. They cost us an afternoon of reading.
