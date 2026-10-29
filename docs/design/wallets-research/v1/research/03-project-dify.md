# Dify: how a hosted model allowance works when it is built the cheap way

## What this document is

Dify is an open source platform for building applications that call language models. Its
cloud version does the thing we are about to do: it lets a new person use models without
bringing their own provider key, by spending the platform's own key and counting the usage
against a per tenant allowance.

This document maps how that counting works. It reads the source rather than the marketing
pages, because the source is the only place where the failure modes are visible. It answers
the questions that decide our own design: what tables exist, how a balance is produced, what
stops a double charge, what stops two requests spending the last credit at the same time,
what happens when the cost is unknown until the work finishes, and what it cost Dify to move
from a plain counter to a credit system after the fact.

All line numbers refer to commit `a77236e56473b32e3e15add12654b4c0fb6d184f`, dated 3 August
2026, cloned from `https://github.com/langgenius/dify`. Paths are relative to the repository
root. The repository had 151,198 stars at the time of reading, per
`https://api.github.com/repos/langgenius/dify`.

A licence warning before anything else. Dify is not plain Apache 2.0. The `LICENSE` file at
the repository root is Apache 2.0 with added conditions, and the first one says you may not
use the source code to operate a multi tenant environment without written permission from
LangGenius. A tenant in Dify means a workspace. That is exactly what we run. So we can read
this code and copy its ideas, but we must not paste its code into Agenta.

## The words used here

A **ledger** is a list of entries that only grows. You never edit a row. If you got something
wrong, you add a correcting row. A **balance** in a ledger system is not stored as the truth.
You derive it by summing the entries.

A **debit** removes value from an account. A **credit** adds value to it.

A **counter** is the opposite of a ledger. It is a single number in a single row that you
overwrite. `quota_used = quota_used + 5` is a counter update. It is cheap, and it forgets
everything about how it reached its current value.

A **hold** (also called a reservation or an authorisation) is value set aside before the real
amount is known. A petrol station holds a round sum on your card before you pump, then
**settles** for the true amount and releases the rest. This is our exact shape, because we do
not know what a model call costs until the response arrives.

**Idempotency** means that applying the same operation twice has the same effect as applying
it once. An **idempotency key** is an identifier the caller attaches to a write so the server
can recognise a repeat and ignore it.

**Metering** means counting what someone used, for example tokens or seconds of compute. An
**entitlement** answers a different question: is this tenant allowed to do this at all.

**Overshoot** means the amount a tenant consumed beyond their limit before the system stopped
them.

**Reconciliation** means comparing your own numbers against an outside record, such as the
provider's invoice, and explaining every difference.

A **quota unit** in Dify is the thing the allowance is measured in. Dify supports three:
tokens, credits, and calls.

## What a Dify user actually gets

A new workspace on Dify Cloud gets 200 message credits. They are a one time allocation and
they do not renew. The paid tiers get a monthly allocation instead: 5,000 credits per month on
Professional and 10,000 on Team, per `https://dify.ai/pricing`. Dify's own wording on that
page is that "message credits are provided to help you easily try out different models from
OpenAI, Anthropic, Gemini, xAI, DeepSeek, Tongyi in Dify" and that credits "are consumed based
on the model type". When they run out, the user connects their own key.

The 200 matches the default in the source. `api/configs/feature/hosted_service/__init__.py:11`
sets `HOSTED_POOL_CREDITS` to 200.

The phrase "consumed based on the model type" is worth pausing on, because it is the single
most surprising design decision in the whole system. A credit is not a token and it is not a
fraction of a dollar. It is a flat integer per model, read from a comma separated environment
variable. Here is the function, at
`api/configs/feature/hosted_service/__init__.py:16`:

```python
def get_model_credits(self, model_name: str) -> int:
    if not self.HOSTED_MODEL_CREDIT_CONFIG:
        return 1
    credit_map = dict(
        item.strip().split(":", 1) for item in self.HOSTED_MODEL_CREDIT_CONFIG.split(",") if ":" in item
    )
    for pattern, credit in credit_map.items():
        if pattern.strip() == model_name:
            return int(credit)
    return 1
```

The configuration format is `gpt-4:20,gpt-4o:10`. A message that used one model call and a
message that used ninety nine model calls cost the same number of credits, as long as they
used the same model. A message with 200 tokens and a message with 200,000 tokens also cost the
same. Six of the nine hosted providers use this unit, including OpenAI, Anthropic and Gemini
(`api/core/hosting_configuration.py:134`, `:167`, `:197`, `:227`, `:256`, `:286`). Azure OpenAI
charges one credit per call (`:71`), and three smaller providers charge by tokens (`:317`,
`:335`, `:353`).

That decision makes the product easy to explain and makes the accounting almost free. It also
means Dify's cost exposure per credit is unbounded. We will come back to what that costs.

## The data model

Three tables matter. Only one of them is new.

### The table that holds provider settings and the original counter

`providers` predates the credit work by years. The model is at
`api/models/provider.py:34`. Simplified:

| Column | Type | What it holds |
| --- | --- | --- |
| `id` | uuid | primary key |
| `tenant_id` | uuid | the workspace |
| `provider_name` | text | for example `openai` |
| `provider_type` | text | `system` when Dify pays, `custom` when the user pays |
| `quota_type` | text | `trial`, `paid`, or `free` |
| `quota_limit` | bigint | the allowance, where -1 means unlimited |
| `quota_used` | bigint | the running counter |
| `credential_id` | uuid | which stored credential this row uses |
| `is_valid` | bool | whether the row is usable |
| `last_used` | timestamp | last time this provider served a request |

There is a unique constraint on `(tenant_id, provider_name, provider_type, quota_type)`, at
`api/models/provider.py:43`. So a workspace gets one row per provider per quota type, and the
counter lives in `quota_used`.

Nothing here is append only. `quota_used` is overwritten in place. There is no row anywhere
that says "on this date, this message, this many units".

### The table that holds credit pools

`tenant_credit_pools` arrived on 8 January 2026 in commit `fe0802262`, titled
`feat: credit pool (#30720)`. The model is at `api/models/model.py:2757` and the migration is
`api/migrations/versions/2025_12_25_1039-7df29de0f6be_add_credit_pool.py`. The whole thing:

| Column | Type | What it holds |
| --- | --- | --- |
| `id` | uuid | primary key |
| `tenant_id` | uuid | the workspace |
| `pool_type` | varchar(40) | `trial` or `paid`, default `trial` |
| `quota_limit` | bigint | the allowance, where -1 means unlimited |
| `quota_used` | bigint | the running counter |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

That is the entire credit system as stored data. Two integers per pool per tenant.

Two details in the migration deserve attention, because both would bite us if we copied it
without thinking. First, the indexes on `tenant_id` and on `pool_type` are separate and
neither is unique (migration lines 51 to 53). There is no unique constraint on
`(tenant_id, pool_type)`. Second, the only code that creates a pool,
`CreditPoolService.create_default_pool` at `api/services/credit_pool_service.py:101`, does a
plain insert with no existence check, and every read is a `select ... limit 1` with no
ordering (`api/services/credit_pool_service.py:141`). If a workspace ever ends up with two
trial pools, reads pick an arbitrary one and deductions may land on the other. Nothing in the
schema prevents that.

### The table that used to hold purchases

`provider_orders` was added on 10 August 2023
(`api/migrations/versions/bf0aec5ba2cf_add_provider_order.py`). It records one purchase per
row: `payment_product_id`, `payment_id`, `transaction_id`, `quantity`, `currency`,
`total_amount`, `payment_status`, `paid_at`, `pay_failed_at`, `refunded_at`. The model still
exists at `api/models/provider.py:211`. It is effectively append only, and it is the closest
thing in the repository to a ledger entry.

It is also dead. A search for `ProviderOrder` across the API finds hits only in
`api/tests/unit_tests/models/test_provider_models.py`. Nothing in production reads or writes
it. Buying credits now happens through a payment link served by a separate billing service
(`api/services/billing_service.py:359`), and the record of the purchase lives outside this
repository.

### What does not exist

There is no table of deductions. No `credit_transactions`, no `usage_events`, no
`quota_usage_history` in the open source schema. A search of every Alembic migration for a
created table whose name contains ledger, transaction, usage, entry or wallet returns only
`agent_home_snapshots`, which is unrelated to money.

## How a balance is produced

The balance is stored, not derived. `remaining_credits` is computed on the fly from the two
stored integers, at `api/models/model.py:2786`:

```python
@property
def remaining_credits(self) -> int:
    return max(0, self.quota_limit - self.quota_used)
```

The `max(0, ...)` clamp is the whole story of the design in one line. The stored balance can
never go negative and can never show a deficit, because the code refuses to represent one.

The user interface shows the same two numbers and nothing else. The console reads them from
the workspace endpoint and clamps again on the client
(`web/app/components/header/account-setting/model-provider-page/provider-added-card/use-trial-credits.ts:10`).
The backend that fills them in is `api/services/workspace_service.py:64` onward. There is no
list of transactions in the product, because there is nothing to list.

The trade off Dify accepted is explicit and reasonable for a trial: reading a balance is a
single row lookup with no aggregation, and writing one is a single row update. The cost is
that the number carries no explanation. If a customer asks why their balance is 43, the
honest reconstruction goes through the `messages` table, which does record per message usage:
`message_tokens`, `answer_tokens`, `total_price`, `currency`, `model_provider` and `model_id`
(`api/models/model.py:1550` to `:1571`). Workflow node runs record equivalent numbers inside
`workflow_node_executions.execution_metadata` as JSON (`api/models/workflow.py:1041`, keys
documented at `:968`).

So Dify could rebuild a plausible story. It could not produce an audit. The reconstruction
would have to re-derive the credit cost of each message by applying today's
`HOSTED_MODEL_CREDIT_CONFIG`, and that configuration is an environment variable with no
history. It would not know which pool each deduction hit. Most importantly, it would not know
which deductions were silently reduced, because the code that reduces them writes only a log
line.

## How one charge is made, start to finish

Follow a single chat message on a model that Dify pays for.

The request enters `AppGenerateService`. Before anything runs, a guard at
`api/services/app_generate_service.py:136` reserves one unit of workflow quota from the
external billing service, then commits it as soon as the rate limiter admits the request. That
guard counts runs, not credits. It is a separate allowance.

Next the app configuration is converted, and that is where the only pre flight credit check
happens, at
`api/core/app/app_config/easy_ui_based_app/model_config/converter.py:56`:

```python
elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
    raise QuotaExceededError(f"Model provider {provider_name} quota exceeded.")
```

`QUOTA_EXCEEDED` is set at `api/core/entities/provider_configuration.py:1851` to `:1855`
whenever the quota configuration for the current type is not valid. Valid means exactly this, at
`api/core/provider_manager.py:1586`:

```python
is_valid=trail_pool.quota_limit > trail_pool.quota_used or trail_pool.quota_limit == -1,
```

That is a boolean. It asks whether the balance is above zero. It does not ask whether the
balance covers the run about to start.

A row in `messages` is created and committed before generation begins
(`api/core/app/apps/message_based_app_generator.py:200` and `:248`). The model call or calls
then happen, and the answer streams to the client as it arrives.

At the end, `_save_message` writes the token counts and prices onto the message row and fires
a signal, at `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py:443`:

```python
message_was_created.send(
    message,
    application_generate_entity=self._application_generate_entity,
)
```

The commit of that session happens on the next line of the caller, at `:297`. Hold that
thought; it matters later.

The signal handler is
`api/events/event_handlers/update_provider_when_message_created.py:83`. It computes the
amount at `:220` using the quota unit, then branches on the quota type at `:138`. Trial and
paid go to the credit pool. Free goes to the old counter on the providers table.

The pool branch calls a helper whose docstring states the design out loud, at `:199`:

```python
def _deduct_credit_pool_quota_capped(*, tenant_id: str, credits_required: int, pool_type: str) -> None:
    """Apply post-generation credit accounting without failing message persistence on quota exhaustion."""
```

It calls `CreditPoolService.deduct_credits_capped`, and warns when it got less than it asked
for (`:210`):

```python
if deducted_credits < credits_required:
    logger.warning(
        "Credit pool exhausted during message-created accounting, "
        "tenant_id=%s, pool_type=%s, credits_required=%s, credits_deducted=%s",
        ...
    )
```

The deduction itself is at `api/services/credit_pool_service.py:276`:

```python
def deduct() -> int:
    pool = cls._get_locked_pool(session=session, tenant_id=tenant_id, pool_type=normalized_pool_type)
    if not pool:
        logger.warning("Credit pool not found, tenant_id=%s, pool_type=%s", tenant_id, normalized_pool_type)
        return 0

    deducted_credits = min(credits_required, pool.remaining_credits)
    if deducted_credits <= 0:
        return 0

    pool.quota_used += deducted_credits
    session.commit()
    return deducted_credits
```

`min(credits_required, pool.remaining_credits)` is the accepted overshoot. The work is already
done and the tokens are already spent. The counter takes what it can and the difference
disappears into a log line.

The free branch is the conditional statement, built at
`api/events/event_handlers/update_provider_when_message_created.py:155` and executed at `:277`
to `:311`. In SQL it amounts to:

```sql
UPDATE providers
   SET quota_used = quota_used + :n,
       last_used  = :now
 WHERE tenant_id = :tenant
   AND provider_name = :provider
   AND provider_type = 'system'
   AND quota_type = :quota_type
   AND quota_limit > quota_used;
```

When it changes no rows, the code logs a warning and moves on (`:319`):

```python
if rows_affected == 0 and description == "quota_deduction_update":
    logger.warning(
        "No Provider rows updated for quota deduction. "
        "This may indicate quota limit exceeded or provider not found. "
        "Filters: %s",
        filters.model_dump(),
    )
```

Workflows take a parallel path. `LLMQuotaLayer` at
`api/core/app/workflow/layers/llm_quota.py` hooks the graph engine. It runs the same pre
flight check before every model backed node (`:77`) and the same deduction after every one
(`:104`). That is a meaningful improvement over the chat path, because the check happens
between nodes rather than once per message.

## How concurrency is handled

There are two different mechanisms, one per path, and they are not equally strong.

### The credit pool path uses a Redis lock plus a row lock

Every deduction acquires a per tenant lock in Redis before it touches Postgres, at
`api/services/credit_pool_service.py:66`:

```python
lock = redis_client.lock(
    lock_key,
    timeout=CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS,          # 10
    blocking_timeout=CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS,  # 5
)
lock_acquired = lock.acquire(blocking=True)
if not lock_acquired:
    raise QuotaExceededError("Failed to acquire credit pool lock")
```

Then it selects the row with `with_for_update()`, at `:90`, which takes a Postgres row lock
for the rest of the transaction.

The file's own docstring explains why both exist: the Redis lock keeps concurrent accounting
for one tenant "from piling up database transactions while preserving cross-tenant
concurrency". The Redis lock is a performance guard. The row lock is the correctness guard.
That layering is sound, and unlike the Redis caching elsewhere in this handler, the read and
the write here happen inside one Postgres transaction, so the check and the update cannot be
separated.

This lock was not in the original design. It was added on 22 June 2026, five months after the
pools shipped, in commit `7cca8b6bb`, `fix: Add tenant-level Redis lock for credit pool
deduction (#37753)`.

Note what the lock does on failure. If Redis is unreachable, or if the lock is held for longer
than five seconds, the deduction raises `QuotaExceededError`. It does not fall through to an
unguarded update, and it does not skip the charge. It throws, and the exception escapes into
the message pipeline. That has consequences covered below.

### The providers counter path relies on Postgres alone

The free path has no lock. It relies on the `quota_limit > quota_used` predicate inside the
`UPDATE`. That predicate is stronger than it looks. Under the READ COMMITTED isolation level,
which is Postgres's default, an `UPDATE` that finds a row locked by another transaction waits
for that transaction, then re-evaluates its own `WHERE` clause against the newly committed
version of the row
(`https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED`). So a
hundred concurrent requests do not each read "under the limit" and each apply. They serialise,
and the first one that pushes `quota_used` to or past `quota_limit` causes every later one to
match nothing and log a warning.

That gives the counter a "cross the line once" property. The counter can exceed its limit by
at most one request's worth, no matter how many requests arrive together.

The comment the shortlist flagged is real, but it is about a different thing. At
`api/events/event_handlers/update_provider_when_message_created.py:283`:

```python
# NOTE: For frequently used providers under high load, this implementation may experience
# race conditions or update contention despite the time-window optimization:
# 1. Multiple concurrent requests might check the same cache key simultaneously
# 2. Redis cache operations are not atomic with the database update
# 3. Heavy providers could still face database lock contention during peak usage
```

Read the code it sits above and you can see it guards the `last_used` timestamp, not the
quota. Dify caches the last time a provider was used in Redis for ten minutes and skips the
timestamp write if it was updated in the last five, purely to reduce write contention on a hot
row. The race the comment admits is that two requests both decide to write the timestamp. That
is harmless. The quota update below it has no Redis involvement at all.

This is worth correcting, because it changes the comparison. The conditional statement in Dify
is weaker than our meters DAO for other reasons, not because it races on a cache key.

Three commits in mid 2025 show what this row cost them anyway: `8f15341f1`
(`fix(event_handlers): DB dead lock`, 25 June 2025), `3acaa5988`
(`fix(update_provider_when_message_created): Fix db transaction`, same day), `ad2c54116`
(`Fix missing database commit in provider update handler`, 22 August 2025), and `410fe7293`
(`opt(api): optimize update contention on the providers table`, 26 August 2025). The
deadlock came from issuing two updates to overlapping sets of rows in one transaction. The
fix is still visible at `:254`, where the updates are sorted by tenant and provider name
before execution so every transaction takes locks in the same order.

## How a charge is protected against being applied twice

In the open source code, it is not.

There is no idempotency key, no unique constraint on any request identifier, and no record of
which message caused which deduction. The signal fires once per message, and if the process
crashed after the model call but before the signal, the charge is simply lost. If some future
retry re-fired the signal, the charge would apply again, and nothing would notice.

The reason this is survivable for Dify is that a lost or duplicated charge on a 200 credit
trial is worth a few cents, and there is no invoice to defend.

The paid path, which lives outside this repository, does have request identifiers. When
`BILLING_ENABLED` is set, `CreditPoolService` stops touching Postgres entirely and calls an
HTTP service instead (`api/services/credit_pool_service.py:261`):

```python
result = BillingService.quota_consume_capped(
    tenant_id=tenant_id,
    feature_key=FEATURE_KEY_CREDIT_POOL,
    bucket=normalized_pool_type,
    request_id=str(uuid4()),
    amount=credits_required,
    meta={"source": "credit_pool.deduct_capped"},
)
```

The `request_id` is generated fresh at the call site with `uuid4()`. That means it is not an
application level idempotency key. If the whole operation were retried, a new identifier would
be minted and the tenant would be charged twice.

It does give transport level protection. `_send_request` at
`api/services/billing_service.py:419` is wrapped in a `tenacity` retry that fires only on
`httpx.RequestError`, waits two seconds, and gives up after ten:

```python
@retry(
    wait=wait_fixed(2),
    stop=stop_before_delay(10),
    retry=retry_if_exception_type(httpx.RequestError),
    reraise=True,
)
```

Those retries resend the identical payload, including the same `request_id`. So the billing
service can recognise and drop a duplicate caused by a dropped connection. It cannot recognise
a duplicate caused by anything above that layer. That is a useful distinction for us: the same
key serves both purposes only if it is derived from the unit of work rather than minted at the
moment of the call.

## How they handle a cost that is unknown until the work finishes

For model credits, they do not handle it. They charge after the fact and accept the shortfall.
That is the meaning of `deduct_credits_capped`.

There is a strict alternative in the same file, `check_and_deduct_credits` at
`api/services/credit_pool_service.py:165`, which refuses to deduct at all if the balance does
not cover the full amount:

```python
remaining_credits = pool.remaining_credits
if remaining_credits <= 0:
    raise QuotaExceededError("No credits remaining")
if remaining_credits < credits_required:
    raise QuotaExceededError("Insufficient credits remaining")
```

It has no production callers. A search for `check_and_deduct_credits` across the API finds its
own definition and test files, nothing else. The workflow path used it when pools first
shipped (it is right there in the `fe0802262` diff of
`api/core/workflow/nodes/llm/llm_utils.py`), and the current code at
`api/core/app/llm/quota.py:125` calls the capped version instead. So Dify tried the strict
rule and backed away from it.

For other resources they do use holds, and the machinery is worth studying because it is the
shape we need. `api/services/quota_service.py` wraps the external billing service in a three
phase lifecycle. Its docstring at `:17`:

```python
"""
Result of a quota reservation (Reserve phase).

Lifecycle:
    charge = QuotaService.consume(QuotaType.TRIGGER, tenant_id)
    try:
        do_work()
        charge.commit()   # Confirm consumption
    except:
        charge.refund()   # Release frozen quota

If neither commit() nor refund() is called, the billing system's
cleanup CronJob will auto-release the reservation within ~75 seconds.
"""
```

Three properties of that design are directly reusable.

The reservation expires on its own. A crashed process leaks a hold for about 75 seconds and no
longer. That is what makes holds safe to use in a system where callers die.

The settlement amount may differ from the reserved amount, and the difference comes back
automatically. `commit(actual_amount)` is documented at `api/services/quota_service.py:41`:
"If less than reserved, the difference is refunded automatically."

The release is unconditionally safe. `refund()` at `:73` is documented to be a no operation
when the charge failed, when it was already committed, and when it was already refunded, and
it promises never to raise.

Two of the three verbs used here appear in the client for the external service:
`quota_reserve`, `quota_commit`, `quota_release`, and `quota_consume_capped`
(`api/services/billing_service.py:250`, `:273`, `:296`, `:318`). The implementations live in a
closed repository, so how the reservations are stored is not visible. The interface is.

One detail is a warning rather than a model. When the reserve call fails for any unexpected
reason, `QuotaService.reserve` returns `unlimited()` at `api/services/quota_service.py:178`,
which is a charge that permits the work and records nothing. `QuotaService.check` at `:193`
likewise returns `True` on error. The billing service being down means everything is free.
That is a deliberate availability choice and it is defensible for a rate limit. It would not
be defensible for a credit balance funded by real money.

## What the worst case overshoot actually is

Start with the chat path, because it is the one that matches our product.

A workspace has one credit left. The pre flight check asks only whether the balance is above
zero, so the message starts. If the app is an agent, the loop runs up to
`min(app_config.agent.max_iteration, 99) + 1` model calls before it stops
(`api/core/agent/fc_agent_runner.py:120`). Every one of those calls sends the full accumulated
context. The usage totals are summed across iterations (`:131`) and stored on the message. At
the end, exactly one deduction happens, and on a credits based provider its size is a flat
integer per model, unrelated to how many calls occurred.

So the counter moves by one credit. The real consumption is up to a hundred model calls.

That is per message. Nothing reserves anything, so concurrent messages all pass the same pre
flight check. The only limit on how many run at once is the per application concurrency cap
applied at `api/services/app_generate_service.py:144`. If a workspace is allowed five
concurrent runs, a workspace with one credit left can begin five agent runs of up to a hundred
model calls each.

Put our own numbers on it, since Dify's exposure is not the interesting figure. Our harness
replays about 23,600 tokens of context per model call. One hundred calls is roughly 2.36
million input tokens. At three dollars per million input tokens, that is about seven dollars
of spend against a balance that showed one credit. Five concurrent runs make it about thirty
five dollars. Those numbers assume no prompt caching and a mid priced model, so treat them as
an order of magnitude rather than a quote. The structural point stands regardless of the
price: the design places no bound on the size of the last transaction.

The workflow path is much better. The check runs before every model backed node and the
deduction after every one, so a workflow stops at the next node boundary. Overshoot there is
one node's worth of tokens per concurrent run.

The counter path on the providers table is bounded by one request, for the Postgres reason
explained above.

The user visible harm from all of this is mild for Dify and would be severe for us. Their
credits are a lead magnet worth a few dollars per workspace. The user sees a balance that hits
zero and a prompt to add their own key. Nobody is billed for the overshoot and nobody
complains. Our situation is different in one specific way: we intend to sell credits and let
people earn them. The moment a credit has a price, a balance that silently absorbs a shortfall
becomes a number we cannot defend in a support conversation.

## What happens to the user's response when the deduction fails

The answer is already on the user's screen in every case, because the deduction runs after the
stream finishes. What varies is whether the message survives.

When the pool is exhausted, the deduction takes whatever is left, logs a warning, and returns
normally. The message is saved. Nothing is shown to the user. The next message is the one that
gets refused, by the pre flight check.

When the pool row is missing entirely, the deduction returns zero, logs, and returns normally.
The message is saved and nothing is charged, forever.

When Redis is unreachable or the tenant lock cannot be taken within five seconds, the
deduction raises. Trace the exception. `_deduct_with_tenant_lock` raises `QuotaExceededError`
at `api/services/credit_pool_service.py:79`, or the outer handler at `:294` converts an
unexpected exception into the same error. `_deduct_credit_pool_quota_capped` at
`api/events/event_handlers/update_provider_when_message_created.py:199` does not catch it. The
`try` block in `handle` at `:171` wraps only `_execute_provider_updates`, which runs later. So
the exception leaves the signal receiver, and blinker propagates receiver exceptions to the
sender. That returns it into `_save_message`, and from there to
`api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py:296`. The `session.commit()`
on the following line never runs.

The message row was created and committed before generation, so it exists. Its answer column
still holds the empty placeholder. The user watched the answer stream in and will find an
empty message when they reload the conversation, and no credits were charged.

I traced this path in source and did not execute it. The test that would settle it: stop
Redis, send one chat message on a system provider model with a trial pool, confirm that the
answer streams to the client, then read the `messages` row and check whether `answer` and
`answer_tokens` were persisted.

That failure mode is a direct argument for a design rule in our system. Accounting must not be
able to destroy the artefact it is accounting for. Either charge before the work and settle
after, or write the charge somewhere that cannot take the response down with it.

## What else the design carries, and what it does not

**Refunds.** None for model credits. `quota_used` only increases, and no code path ever
decreases it. Refunds exist for the reservation based quotas through
`BillingService.refund_tenant_feature_plan_usage` at `api/services/billing_service.py:396` and
through `QuotaCharge.refund()`, but those are release operations against a hold, not
corrections against a balance.

**Expiry.** Not in the open source code. `next_credit_reset_date` is surfaced to the console
at `api/services/workspace_service.py:65`, but the value comes from the external features
service. There is no scheduled task in `api/schedule/` that resets any pool. The monthly reset
that the pricing page promises happens outside this repository.

**Ordering between kinds of credit.** This one exists and is worth copying. Dify has three
allowance types and a fixed spending order, at `api/core/provider_manager.py:1678`:

```python
"""
Choice current using quota type.
paid quotas > provider free quotas > hosting trial quotas
"""
last_quota_configuration = None
for quota_type in [ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL]:
    if quota_type in quota_type_to_quota_configuration_dict:
        last_quota_configuration = quota_type_to_quota_configuration_dict[quota_type]
        if last_quota_configuration.is_valid:
            return quota_type
```

The mechanism is a hard coded list, resolved fresh on every configuration load. It is crude
and it works. Note that the order is not the one we will want. Dify burns paid credits first
because paid credits mean the customer is on a plan. We will want promotional and earned
credits to burn before purchased ones, so a purchased credit is the last thing to disappear.

**Negative balances.** Impossible to represent. `remaining_credits` clamps at zero
(`api/models/model.py:2786`), the capped deduction never writes more than the remainder, and
the console clamps a third time. A deficit is not stored, so a deficit cannot be reported or
recovered.

**Reconciliation against the provider's invoice.** Nothing. There is no place where the
provider's reported usage meets Dify's counters. With credits defined as flat integers per
model, a reconciliation would not be arithmetic anyway. The relationship between a credit and
a dollar is a business decision re-made every time somebody edits an environment variable.

## The move from a counter to credit pools, and what it cost

This is the part that sizes our own risk, so it deserves detail.

Before January 2026, a workspace's model allowance lived in the `providers` table, one counter
per provider per quota type. Every deduction was the conditional statement quoted earlier.

Commit `fe0802262`, on 8 January 2026, moved trial and paid allowances into
`tenant_credit_pools`. The commit touched 14 files, added 693 lines and removed 75.

The mechanical part was small. A new table, a new service, an insert on workspace creation
(`api/services/account_service.py:1289`), two extra fields on the workspace response, and a
branch in each of the two deduction sites.

The interesting part is the shape of the change. Look at what the same commit did to
`api/core/provider_manager.py`. Rows in `providers` for trial and paid quota types are still
created, but their limit is now hard coded to zero:

```python
new_provider_record = Provider(
    ...
    quota_type=quota.quota_type,
    quota_limit=0,  # type: ignore
    quota_used=0,
    is_valid=True,
)
```

And the code that builds the quota configuration grew a three way branch: use the trial pool if
one exists, else use the paid pool if one exists, else fall back to the counter on the provider
row (`api/core/provider_manager.py:1580` to `:1610`).

There was no data migration. The Alembic revision creates the table and its indexes and
nothing else. No backfill of existing tenants, no reconciliation of the old counters, no
script. Every workspace that existed before that deploy had a counter and no pool.

That fallback branch is what makes the absence of a backfill survivable, and it is also where
the seam shows. For display, a tenant with no pool falls back to the old counter, so the
console shows a sensible number. For deduction, the trial branch calls
`deduct_credits_capped`, which finds no pool, logs "Credit pool not found", and returns zero
(`api/services/credit_pool_service.py:279`). The counter it displays is no longer the counter
anything writes to.

Reading only the open source code, a pre existing workspace on a trial quota would therefore
consume hosted models without any deduction landing anywhere. I could not verify what Dify's
cloud actually did, because a backfill run directly against their production database would
leave no trace in this repository, and their cloud runs with `BILLING_ENABLED` set, which
bypasses these tables entirely (`api/services/credit_pool_service.py:52` and `:124`). The test
that would settle it: create a workspace on a build from before the commit, upgrade the code,
and watch whether `tenant_credit_pools` gains a row and whether usage moves any counter.

Now the question that matters for us. Would this migration have been painless if the original
design had recorded immutable entries instead of a counter?

Yes, and the reason is specific rather than general. The pain in this migration is not the
schema change. Adding a table is easy either way. The pain is that a counter cannot be split.
`quota_used = 1,500` on a provider row does not tell you how much of that 1,500 was trial
usage, how much was paid usage, or which of it should move into which new pool. There is no
correct backfill, so the only options were to invent one, to abandon the history, or to write
a fallback branch and let old tenants sit on the old shape forever. They chose the third,
which is why `api/core/provider_manager.py` now carries a three way branch and
`api/core/app/llm/quota.py` carries a three way match statement for what is conceptually one
operation.

Had the original design written one row per deduction with a type on it, the backfill would
have been a `GROUP BY`. Pools would have been a view over the entries, or a cache of that view
seeded by a single query, and the fallback branch would not exist.

Two more consequences arrived later and are part of the same bill. The Redis lock came five
months after the pools, in June 2026 (`7cca8b6bb`). The move to an external balance service
came a month after that, in July 2026 (`5d6131886`, `feat(api): use billing quota for credit
pool (#38028)`). That second commit is the one to note. Roughly six months after building
credit pools in Postgres, Dify's cloud stopped using them and moved the balance behind an HTTP
service with reserve, commit, release and capped consume. The Postgres pools are now the self
hosted fallback. The design in this repository is the one they outgrew.

## Their conditional statement compared with our meters DAO

Both are a single guarded write. Ours is stronger, and the reasons are worth naming precisely
so we know what we are keeping.

Dify's, from
`api/events/event_handlers/update_provider_when_message_created.py:155` and `:277`:

```sql
UPDATE providers SET quota_used = quota_used + :n
 WHERE ... AND quota_limit > quota_used;
```

Ours, from `api/ee/src/dbs/postgres/meters/dao.py:465` onward, is an insert with
`ON CONFLICT DO UPDATE`, a `where` on the conflict clause, and `RETURNING`:

```python
stmt = (
    insert(MeterDBE)
    .values(..., value=desired_value, synced=0)
    .on_conflict_do_update(
        index_elements=[MeterDBE.meter_id],
        set_={"value": func.greatest(
            (MeterDBE.value + meter.delta) if meter.delta is not None else meter.value, 0)},
        where=where,
    )
    .returning(MeterDBE.value)
)
```

| Property | Dify's statement | Our meters DAO |
| --- | --- | --- |
| Creates the row if absent | No. A missing row silently charges nothing. | Yes. The insert seeds it in the same statement. |
| Reports the outcome to the caller | No. It reads `rowcount` and logs. | Yes. `RETURNING` gives the caller the new value, and `allowed = row is not None` at `:507`. |
| Reports the resulting balance | No. | Yes, the actual post write value. |
| Rejects a request bigger than the whole limit | No. | Yes, in both strict and non strict mode, at `:398` to `:422` and `:433` to `:455`. |
| Offers a no overshoot mode | No. | Yes. `quota.strict` makes the predicate `value + delta <= limit` at `:441`. |
| Clamps at zero on refunds | No. It only ever adds. | Yes. `func.greatest(..., 0)` at `:488`. |
| Handles periodic allowances | No. | Yes, through period normalisation at `:384`. |
| Documents its overshoot rule | Only in a warning log. | Yes, in the comment at `:443` to `:448` and mirrored in the cache fast path at `api/ee/src/core/access/entitlements/service.py:499`. |

The two decisive differences are `RETURNING` and strict mode.

`RETURNING` turns a fire and forget write into a decision. Dify's statement cannot tell its
caller whether the charge landed, so the caller cannot refuse the next request, cannot show
the user a real number, and cannot record a shortfall. Ours can, which is why our
entitlements service can deny a request on the same round trip that records it.

Strict mode is the piece Dify does not have at all. Our non strict rule is deliberately the
same "cross the line once" behaviour that Postgres gives Dify by accident, with the addition
that a single request larger than the entire limit is rejected up front. Our strict rule
refuses any predictable overshoot. Having both, chosen per quota, is exactly the control a
funded free tier needs: strict on anything backed by real money, non strict on anything where
a small overrun is cheaper than an extra round trip.

Two things Dify has that our meters DAO does not. Dify's pool deduction returns the amount it
actually deducted, so the caller at least knows a shortfall occurred, even if only a log
records it. And Dify has an explicit hold interface for its other quotas, which our meters
have no equivalent of.

## What to copy, what to simplify, what to avoid

### Copy

**One table for the balance, keyed by tenant and pool type, with the limit and the used amount
as plain integers.** It is genuinely the right first version for the read path. A balance
lookup should be one row.

**The fixed spending order across allowance kinds, resolved at read time.** Dify's list at
`api/core/provider_manager.py:1693` is three lines and it solves a real problem. Ours will be
promotional, then earned, then purchased. Resolve it in code rather than encoding priority in
the data, so changing the order does not need a migration.

**The three verb lifecycle from `api/services/quota_service.py`: reserve, then commit with the
actual amount, then release.** Copy the three properties that make it safe. Reservations
expire on a timer so a dead process cannot hold value forever. Settling for less than the
reservation returns the difference automatically. Release is idempotent and never raises. This
is the answer to our unknown cost problem, and Dify's own trajectory (a strict deduction, then
a capped one, then an external service with reservations) is evidence that you end up here.

**Charging at the layer where you can stop.** The workflow layer at
`api/core/app/workflow/layers/llm_quota.py` checks before every model backed node instead of
once per user message. That is the difference between one node of overshoot and one hundred
model calls of overshoot. Our gateway sits in exactly that position, because every model call
passes through it.

### Simplify

**Do not build separate strict and capped deduction functions.** Dify built both, wired the
strict one in, then quietly switched every caller to the capped one and left the strict one as
dead code. One function with a policy flag, like our `quota.strict`, is less to maintain and
makes the choice visible at the call site.

**Do not put the balance behind an HTTP service in version one.** Dify did that six months in,
and the switch introduced a failure mode where the service being unreachable makes usage free
(`api/services/quota_service.py:178`). Keep the balance in Postgres next to the entries until
there is a concrete reason to move it.

**Do not start with a Redis lock.** It is a throughput optimisation, and Dify added it five
months after shipping, not before. A row lock inside the transaction is the correctness
guarantee. Add the Redis lock when a hot tenant proves it is needed.

### Avoid

**Avoid a counter with no entries behind it.** This is the central lesson and it is the one the
brief asked us to size. The cost is not the schema change. The cost is that a counter cannot
be split, so when the meaning of the number changes, there is no correct backfill. Dify paid
for that with a permanent fallback branch in the provider manager, a match statement in the
quota code, and a class of tenant for whom deduction goes nowhere. Write one immutable row per
charge from day one. Keep the fast balance as a cache of the sum, and make the cache
reconstructible with a `GROUP BY`. That single decision is what turns every future change,
including buying credits, earning credits, expiring grants and refunding a bad run, into an
insert instead of a migration.

**Avoid a credit that is a flat integer per model.** Dify's `get_model_credits` charges the
same for a 200 token call and a 200,000 token call. Our cost per call is dominated by 23,600
replayed context tokens and by whether the provider's prompt cache was hit. A unit that cannot
see tokens cannot see our largest cost lever. Meter in a unit derived from actual token counts
with cache hits priced separately, and if we want a friendly number in the interface, present
credits as a display conversion over that.

**Avoid a pre flight check that only asks whether the balance is above zero.** `quota_limit >
quota_used` lets a run start that the balance cannot possibly cover. Ask instead whether the
balance covers a reservation sized for the run, and hold that amount.

**Avoid letting accounting fail the work it is accounting for.** Dify's chat path can drop a
message from history because a Redis lock timed out, after the user already saw the answer.
Whatever we build, a failure in the accounting path must degrade to a recorded discrepancy,
never to a lost response.

**Avoid a balance that clamps a deficit to zero silently.** `max(0, limit - used)` and
`min(required, remaining)` together mean the system cannot represent the money it lost, so it
cannot report it, alert on it, or bill for it. Let the entries record the true amount and let
the presented balance floor at zero. The floor belongs in the display, not in the data.

**Do not copy code.** The added condition in Dify's `LICENSE` forbids using the source to
operate a multi tenant environment without written permission. Everything in this document is
a description of a design, which is fine to learn from. Pasted code is not.

## Evidence index

Local clone at commit `a77236e56473b32e3e15add12654b4c0fb6d184f`, 3 August 2026.

| What | Where |
| --- | --- |
| Credit pool table definition | `api/models/model.py:2757` to `:2790` |
| Credit pool migration | `api/migrations/versions/2025_12_25_1039-7df29de0f6be_add_credit_pool.py` |
| Provider table with the original counter | `api/models/provider.py:34` to `:115` |
| Unused purchase table | `api/models/provider.py:211`, migration `bf0aec5ba2cf` |
| Deduction service, lock and both deduction modes | `api/services/credit_pool_service.py` |
| Deduction after a chat message | `api/events/event_handlers/update_provider_when_message_created.py` |
| Deduction per workflow node | `api/core/app/workflow/layers/llm_quota.py` |
| Quota unit selection and the free path | `api/core/app/llm/quota.py` |
| Flat credit per model | `api/configs/feature/hosted_service/__init__.py:11` to `:38` |
| Quota unit per hosted provider | `api/core/hosting_configuration.py:71`, `:134`, `:167`, `:197`, `:227`, `:256`, `:286`, `:317`, `:335`, `:353` |
| Pre flight check for chat | `api/core/app/app_config/easy_ui_based_app/model_config/converter.py:56` |
| Validity rule behind that check | `api/core/provider_manager.py:1586` |
| Spending order across allowance kinds | `api/core/provider_manager.py:1678` to `:1702` |
| Hold, settle and release lifecycle | `api/services/quota_service.py` |
| Client for the external balance service | `api/services/billing_service.py:250` to `:340`, retry at `:419` |
| Agent iteration cap and usage summing | `api/core/agent/fc_agent_runner.py:120`, `:131` |
| Signal fired before the commit | `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py:443`, `:296` |
| Commit that introduced pools | `fe0802262`, 8 January 2026 |
| Commit that added the Redis lock | `7cca8b6bb`, 22 June 2026 |
| Commit that moved the balance out of Postgres | `5d6131886`, 8 July 2026 |
| Deadlock and contention fixes on the counter | `8f15341f1`, `3acaa5988`, `ad2c54116`, `410fe7293`, June to August 2025 |
| Licence conditions | `LICENSE`, repository root |
| Public pricing and credit wording | `https://dify.ai/pricing` |
| Postgres re-evaluation under READ COMMITTED | `https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED` |
| Our meters DAO for comparison | `api/ee/src/dbs/postgres/meters/dao.py:340` to `:518` (in the Agenta repository) |
| Our cache fast path mirroring the same rule | `api/ee/src/core/access/entitlements/service.py:492` to `:507` (in the Agenta repository) |

Two claims in this document are traced in source but not executed, and each is marked where it
appears: that a Redis outage causes a streamed answer to be lost from the message history, and
that a workspace created before January 2026 consumes hosted models without any deduction
landing. The tests that would settle them are stated alongside each claim.
