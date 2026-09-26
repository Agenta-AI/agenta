# Wallets: where the code and the design disagree

This page lists every place where the wallet code and the original design documents say
different things. It covers the gaps found by the cold spec review of 2026-09-25, and every
place where the fixes made on `wallets/takeover` that night changed behaviour the design
described.

The rule is that nobody silently changes the original author's design. So each row states
both sides, says which side should move and why, and gives one of two statuses:

- **Applied.** The code changed, and the decision is recorded in the numbered item of
  [v1/open-designs.md](../v1/open-designs.md). The
  [foundation spec](openspec/changes/document-wallet-foundation/specs/wallet-foundation-baseline/spec.md)
  was updated to match.
- **Suggestion.** Nothing was changed on the design side. The row proposes the edit. The
  owner decides.

Paths are relative to `api/` unless they start with `docs/`. "Branch head" means
`wallets/takeover` at `0693b307c1`.

## Summary

| # | Topic | Moves | Status |
| --- | --- | --- | --- |
| 1 | Unacceptable stream entries | Design | Applied (item 20) |
| 2 | A readable entry that keeps failing | Design | Applied (item 20) |
| 3 | Stream length cap | Design | Applied (item 20) |
| 4 | Chargeable measurement with no organization | Design | Applied (item 20) |
| 5 | Measurement replay with different content | Design | Applied (item 20) |
| 6 | What admission reads | Design | Applied (item 21) |
| 7 | Which clock decides expiry at settlement | Design | Applied (item 21) |
| 8 | What identifies one plan change | Design | Applied (item 22) |
| 9 | Which allowance a plan change claws back | Design | Applied (item 22) |
| 10 | When proration starts, and over which period | Design | Applied (item 22) |
| 11 | Provenance on plan-allowance credits | Code | Applied (item 22) |
| 12 | Missed signup grants | Design | Applied (item 15) |
| 13 | Organizations created by the admin route | Design | Applied (item 14) |
| 14 | Plan-change key text in entities and Wave 1 | Design | Applied (item 22) |
| 15 | `check` described as synchronous | Design | Suggestion |
| 16 | `check` described as write-free | Design | Suggestion |
| 17 | Deficit bounded by the floor | Design | Suggestion |
| 18 | `check` reads per-credit rows and a Redis estimate | Design | Suggestion |
| 19 | Debit example carries workflow references | Design | Suggestion |
| 20 | Recurring plan allowance | Design | Suggestion |
| 21 | Debit kinds the stream accepts | Both | Suggestion |
| 22 | Stale MAXLEN text in Wave 1 | Design | Suggestion |
| 23 | Sandbox seconds before any included allowance | Design | Applied (item 23) |

## Applied: code changed, decision recorded

### 1. Unacceptable stream entries

- **Design says.** IM-1-02 acceptance (`v1/nodes/im-1-02-pipeline/specs.md`, "Nothing
  wedges") and WP-1-03 (`v1/nodes/wp-1-03-debit-worker/specs.md`): a malformed or
  unsupported envelope is logged and terminally ACKed. The entry is gone after that.
- **Code does now.** The debit and measurement workers move the entry to a dead-letter
  stream, `<stream>:dead`, before they acknowledge and delete it. An operator can list and
  replay it with `python -m oss.src.tasks.asyncio.shared.dead_letters`. If the dead-letter
  write fails, the entry stays pending.
- **Which side moves, and why.** The design. An acknowledged-and-dropped debit is a charge
  nobody can find again. The dead letter keeps the charge and costs one Redis stream.
- **Status.** Applied in `9f8675313b` and `aa6eb300b0`. Decision in open-designs item 20.
  The acceptance procedure, section 8, now expects a dead letter.

### 2. A readable entry that keeps failing

- **Design says.** IM-1-02 and `DebitWorker.is_permanent_failure`: a debit the worker can
  decode is retried forever, so a database outage can never drop money.
- **Code does now.** Every entry past `max_deliveries` goes to the dead letters, readable or
  not. The wallet workers raise `max_deliveries` from 5 to 20, about ten minutes at the
  30-second idle window. The reclaim pass also walks the whole pending list instead of the
  oldest 50.
- **Which side moves, and why.** The design. Retry-forever let a deterministic failure (an
  amount above the column's range, a `\u0000` in a locator) pin the head of the pending list.
  Later debits were then never reclaimed. The original reason for retry-forever was "never
  drop money", and a dead letter does not drop money.
- **Status.** Applied in `9f8675313b`. Decision in open-designs item 20.

### 3. Stream length cap

- **Design says.** `v1/wave-1.md`: both wallet streams are capped with approximate
  `MAXLEN` trimming at 100,000 entries.
- **Code does now.** No trim. The publishers check `XLEN` and refuse a publish once the
  backlog reaches 100,000, and log an error. A refused debit leaves its measurement pending.
  A refused measurement is the documented best-effort loss at the first publish.
- **Which side moves, and why.** The design. The consumers delete each entry they finish,
  so a stream's length is exactly its unprocessed backlog. Any trim deletes unprocessed
  charges, silently.
- **Status.** Applied in `9f8675313b`. Decision in open-designs item 20. `v1/entities.md` already
  describes the new rule. The MAXLEN text in `v1/wave-1.md` is row 22 below.

### 4. Chargeable measurement with no organization

- **Design says.** Wave 1: the measurement worker persists the measurement and ACKs an entry
  whose project resolves to no organization, with a log line and no debit.
- **Code does now.** The measurement is still persisted. The entry also goes to the dead
  letters, which record the uncharged amount.
- **Which side moves, and why.** The design. A log line is not a record an operator can
  replay once the organization is resolvable.
- **Status.** Applied in `9f8675313b`. Decision in open-designs item 20.

### 5. Measurement replay with different content

- **Design says.** Entities and Wave 1: a repeated `measurement_id` is a no-op insert
  (`ON CONFLICT DO NOTHING`), and the worker prices the incoming envelope.
- **Code does now.** The stored measurement is immutable. `measurements.data.fingerprint`
  holds a SHA-256 of the envelope's content. A replay with the same fingerprint writes
  nothing and is priced as before. A replay with a different fingerprint raises
  `MeasurementConflictError`, writes nothing, and goes to the dead letters unpriced. The
  envelope also rejects repeated component keys.
- **Which side moves, and why.** The design. Before the fix, a reused id could add new
  component rows to an old measurement and charge content that the stored measurement did
  not hold.
- **Status.** Applied in `9f8675313b`. Decision in open-designs item 20. Rows written before
  this change have no fingerprint. That was accepted because the flag has never been on
  outside test databases.

### 6. What admission reads

- **Design says.** The foundation spec, before this pass: `check` compares the general
  balance with the floor.
- **Code does now.** `check` reads `WalletsDAO.get_spendable_balance`: the general balance
  minus the remaining value of every credit whose `end_time` has passed, in one statement.
  The general row itself still counts expired value.
- **Which side moves, and why.** The design. The general row kept counting expired credit,
  so admission accepted calls funded only by value that settlement would refuse to spend.
- **Status.** Applied in `7b8ff59728`. Decision in open-designs item 21. Foundation spec
  updated.

### 7. Which clock decides expiry at settlement

- **Design says.** Nothing explicit. `plan_settlement` re-filtered candidates on the API
  host's clock, after the SQL had filtered them on the database clock.
- **Code does now.** `WalletsDAO.settle` reads `clock_timestamp()` once, after it takes the
  general-balance lock, and uses that value for both filters.
- **Which side moves, and why.** The design, which should state the rule. Two clocks could
  book a live credit's share as deficit. `now()` was also wrong: it is the transaction start,
  before the lock wait, so a credit that expired during the wait still counted as live.
- **Status.** Applied in `a2a0a70f96` and `2139923d9a`. Decision in open-designs item 21.
  Foundation spec updated.

### 8. What identifies one plan change

- **Design says.** `v1/entities.md`, `v1/wave-1.md` and the `grants.py` docstring: the key
  is `plan_change:{subscription_id}:{period_start}`. Two changes in one period then share one
  key, and the second is dropped as a replay.
- **Code does now.** With the flag on, `SubscriptionsService.process_event` runs under a
  per-organization Postgres advisory lock, on its own connection, from reading the plan
  through the wallet adjustment. The webhook keys on `plan_change:{stripe_event_id}`. The
  direct routes key on a fresh `plan_change:{uuid7}`. A double submission reads the new plan
  and is refused as a switch to the current plan.
- **Which side moves, and why.** The design. A caller-supplied key (option 1) would change a
  customer-facing endpoint contract. The lock also orders two different changes for one
  organization, which a key could not.
- **Status.** Applied in `d1cc58b029` and `fc37fe0718`. Decision in open-designs item 22
  (option 2). Option 3, a durable record of a failed adjustment, is deferred. Foundation spec
  updated.

### 9. Which allowance a plan change claws back

- **Design says.** The outgoing allowance is the active plan-allowance credit, and at most
  one is active (`types.py` docstring). The code found it by latest `end_time`, outside the
  lock.
- **Code does now.** `WalletsDAO.apply_plan_change` selects, after the general-balance lock,
  the newest `plan_allowance` credit by `created_at`, skipping one that a plan change already
  clawed back. The mint sets `created_at` from `clock_timestamp()` after the lock. The
  clawback is the unused share of that credit's own lifetime, computed in exact
  microseconds. Both selects are scoped to the organization.
- **Which side moves, and why.** The design. After two changes in one period, two allowance
  credits end at the same instant, and the old lookup could claw from the wrong one. A Hobby
  organization could then keep a Business allowance.
- **Status.** Applied in `d1cc58b029`, `fc37fe0718` and `8720390427`. Decision in
  open-designs item 22. Foundation spec updated.

### 10. When proration starts, and over which period

- **Design says.** Wave 1: proration runs over a window built from the billing anchor day,
  aligned to midnight, at the time the change is processed.
- **Code does now.** The incoming allowance is prorated from the moment the change took
  effect (the Stripe event's `created`) over the subscription's real
  `current_period_start` and `current_period_end`. The direct switch reads the period from
  the Stripe subscription it retrieves. The anchor-day window code is deleted.
- **Which side moves, and why.** The design. A midnight window took part of the allowance
  from an afternoon signup, and a delayed webhook took more.
- **Status.** Applied in `d1cc58b029`. Recorded in open-designs item 22. Foundation spec
  updated.

### 11. Provenance on plan-allowance credits

- **Design says.** The `wallet_credits` example in `v1/entities.md` stores
  `data.references.subscription`.
- **Code did.** It stored only `plan_change_idempotency_key`.
- **Which side moves, and why.** The code. The subscription id is cheap provenance for
  reconciliation.
- **Status.** Applied in `d1cc58b029`. Minted allowance credits record
  `data.references.subscription.id`.

### 12. Missed signup grants

- **Design says.** The foundation spec's missing-balance scenario: lazy provisioning does
  not restore missed grants. Open-designs item 15 left the remedy open.
- **Code does now.** A one-off operator job, `entrypoints/backfill_wallet_signup_grants.py`,
  awards the signup grant to each eligible organization. It is a dry run by default. It
  skips owners with any undated organization. A partial unique index,
  `uq_wallet_credits_org_award_key`, makes the database the final guard against a second
  grant.
- **Which side moves, and why.** The design, which now names the job. Lazy provisioning
  still restores nothing on its own.
- **Status.** Applied in `442d91a6c9`, `580e6d2432` and `0a891a45fe`. Decision in
  open-designs item 15. Foundation spec updated. The job has not run anywhere shared.

### 13. Organizations created by the admin route

- **Design says.** The IM-1-02 acceptance procedure, section 2: every organization created
  through the admin endpoint already has its general balance row.
- **Code does.** `POST /admin/simple/accounts/` never calls the provisioning hook, so the
  organization has no row. Its first debit still settles, because every wallet write
  provisions a missing row lazily. Admission provisions it too, and then refuses at a floor
  of 0 until the organization holds credit.
- **Which side moves, and why.** The design. Lazy provisioning already covers this path.
  Eager provisioning in the admin route would couple the OSS accounts service to the EE
  hooks to write a row the first wallet call writes anyway.
- **Status.** Code unchanged. `a01a962151` and `6f4e567f9d` pin the behaviour with a real
  Postgres and Redis test. Decision in open-designs item 14. Acceptance section 2 corrected.

### 14. Plan-change key text in entities and Wave 1

- **Design says.** `v1/entities.md`, `v1/wave-1.md` and the `grants.py` docstring give the
  old key shape.
- **Status.** Applied in `d1cc58b029` (docstring) and `7e39edb517` (docs). Entities and the docstring now give the delivered
  shapes, and `v1/wave-1.md` marks the old text superseded.

## Suggestions: design text only, not changed

### 15. `check` described as synchronous

- **Design says.** `v1/nodes/wp-1-00-contracts/specs.md`: `WalletCheckPort.check(...)` is
  synchronous.
- **Code does.** `check` is `async` (`ee/src/core/wallets/interfaces.py`). The rest of the
  design already says so.
- **Suggestion.** The node spec moves. Mark the line superseded rather than rewrite it.

### 16. `check` described as write-free

- **Design says.** `v1/nodes/wp-1-01-core-wallet/specs.md`: `check` is write-free.
- **Code does.** `check` inserts the zero general row when it is missing (item 14).
- **Suggestion.** The node spec moves to "writes no debit and no hold; may lazily create the
  zero general row", marked as superseded by item 14.

### 17. Deficit bounded by the floor

- **Design says.** `v1/nodes/wp-1-01-core-wallet/specs.md`: the general balance goes "only
  as far below zero as its configured floor permits".
- **Code does.** Settlement records the whole unfunded remainder as deficit, with no bound.
  The floor only gates admission.
- **Suggestion.** The node spec moves. Consumed usage cannot be refused after the fact, so
  the deficit must be recorded, not capped. The foundation spec already says this.

### 18. `check` reads per-credit rows and a Redis estimate

- **Design says.** The query-path table in `v1/entities.md`: `check(delta)` reads the general
  row, eligible per-credit rows, and a Redis L1 estimate.
- **Code does.** `check` takes only the organization and reads one statement: the general
  row minus expired per-credit remainders (row 6). There is no Redis estimate.
- **Suggestion.** The table moves to the delivered read. Section 5 of the same document
  already describes the delivered signature.

### 19. Debit example carries workflow references

- **Design says.** The `wallet_debits` example in `v1/entities.md` includes
  `data.references.workflow`.
- **Code does.** Debits store `data={}`. `DebitCommandV1` deliberately carries no workflow
  references, as the streams section of the same document says.
- **Suggestion.** The example moves. It contradicts its own document.

### 20. Recurring plan allowance

- **Design says.** `v1/entities.md`: each subscription period creates a plan-allowance
  credit.
- **Code does.** Only a plan change mints a `plan_allowance` credit. A Pro organization that
  never changes plan gets none, and an upgraded organization gets one prorated credit and
  nothing at renewal. `WalletsService` states this in its docstring.
- **Suggestion.** The foundation proposal already lists recurring renewal issuance as outside
  the baseline. Add the same sentence to `v1/entities.md`, so nobody reads "plan allowance"
  as delivered. Building it belongs to open-designs item 3.

### 21. Debit kinds the stream accepts

- **Design says.** `DebitCommandV1` accepts `expiry`, `clawback`, `refund` and `adjustment`
  as well as `gateway_usage`.
- **Code does.** Settlement treats every kind as ordinary spending across eligible credits.
  An `expiry` command cannot name the credit it expires.
- **Suggestion.** Restrict the stream envelope to `gateway_usage`, and add targeted lifecycle
  operations when they have real semantics. Not changed, because the envelope shapes are held
  steady while the coverage contract is designed. No producer sends the other kinds today.

### 22. Stale MAXLEN text in Wave 1

- **Design says.** `v1/wave-1.md` still says both streams were delivered at `MAXLEN 100_000`.
- **Suggestion.** That was true at delivery, so do not rewrite it. Add a "superseded by
  open-designs item 20" note, as the same file already does for the plan-change key.

### 23. Sandbox seconds before any included allowance

- **Design says.** [include-sandbox-usage](openspec/changes/include-sandbox-usage/): a
  sandbox allowance is included first, as a non-monetary entitlement, and the wallet pays
  only for overage, with a configurable hard stop.
- **Code does now.** Every running second of a sandbox on the platform's Daytona account is
  charged to the wallet, priced per vCPU-second and GiB-second at Daytona's list price
  times 1.5. There is no included allowance. At the floor, a new turn is refused and a
  running one finishes. Design: [sandbox-seconds.md](sandbox-seconds.md).
- **Which side moves, and why.** Neither yet. The owner chose wallet-only billing for this
  first slice (2026-09-26), so paid sandbox time is billed before the allowance exists.
  include-sandbox-usage stays the follow-up, and it adds the included portion in front of
  this charge rather than replacing it.
- **Status.** Applied on `wallets/sandbox-seconds`. Decision in open-designs item 23.

## Spec validation

`openspec validate --all --strict --no-interactive`, run from this folder with OpenSpec
1.13.1 after the foundation spec edit: see [validation.md](validation.md) for the result.
