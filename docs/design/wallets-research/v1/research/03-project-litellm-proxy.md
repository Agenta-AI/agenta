# LiteLLM proxy: how it holds money back before a model call, and what we should take from it

## What this document covers

LiteLLM proxy is an open source service that sits between an application and a model provider.
It speaks the OpenAI chat completions dialect, meaning the request and response shape that
`POST /v1/chat/completions` uses. It holds the real provider credentials, hands the caller a
credential of its own (a "virtual key"), records what each call cost, and refuses calls once a
configured dollar ceiling is reached.

That is the same job our gateway has to do. LiteLLM is also built on the same parts we use:
Python, FastAPI, Postgres, and Redis. So it is worth reading closely, both for the design and for
the bugs the design produced.

The version studied is commit `491eda31` of https://github.com/BerriAI/litellm, cloned on
3 August 2026. Every file path below is relative to that repository root. Line numbers refer to
that commit.

This document starts with the vocabulary, then explains how a request travels through the proxy,
then shows the database tables, then goes through the hard parts one at a time: reserving money
before the cost is known, settling it afterwards, surviving two requests at once, surviving a
crash, and pricing a cached prompt. It ends with a judgement about what we should copy, what we
should simplify, and what would be wrong for us.

## The words used here

A **ledger** is a list of entries that only grows. You never edit a row. A mistake is corrected by
adding another row, not by changing the old one. The **balance** is then derived by adding the
entries up.

A **debit** removes value from an account. A **credit** adds value. A **grant** is one deposit of
allowance, for example "50 free credits on signup".

A **hold** (also called a reservation or an authorization) is an amount set aside before the true
amount is known. A petrol station holds a round number on your card, you pump an unknown quantity,
and the station then **settles** for the true amount and releases the rest. LiteLLM calls its hold
a "budget reservation" and its settlement a "reconcile".

An **idempotency key** is an identifier the caller attaches to a write so the same write sent twice
is applied once. It is what stops a client paying twice after a timeout and a retry.

**Metering** means counting what someone used, for example tokens or seconds of compute.

A **dialect** is the request and response shape of a model API. Our agent runner speaks the OpenAI
chat completions dialect only.

**Prompt caching** means the provider charges less for a prefix of the prompt that it has seen
before. A cache **write** stores the prefix and usually costs slightly more than a normal input
token. A cache **read** reuses it and usually costs far less. On `gemini-2.5-flash` a normal input
token costs 3e-07 dollars and a cache read costs 3e-08 dollars, a tenfold discount
(`model_prices_and_context_window.json`, entry `gemini-2.5-flash`).

One LiteLLM specific term matters throughout. A **spend counter** is a single number in Redis, keyed
by the thing being limited, for example `spend:key:<hashed key>` or `spend:org:<org id>`. It holds
the running dollar total for that thing. It is not a ledger. It is one mutable number.

## How a request travels through the proxy

A caller sends a chat completion request with a virtual key in the `Authorization` header. The key
arrives as a string like `sk-...`. LiteLLM hashes it with SHA-256 and looks up the hash in the
`LiteLLM_VerificationToken` table (`litellm/proxy/utils.py:3186-3190`). The raw key is never
stored.

Authentication then does the budget work. In `litellm/proxy/auth/user_api_key_auth.py:2427-2440`,
after the key is validated, the proxy calls `reserve_budget_for_request` and hangs the result on
the in-memory authentication object:

```python
user_api_key_auth_obj.budget_reservation = await reserve_budget_for_request(
    request_body=request_data,
    route=route,
    llm_router=llm_router,
    valid_token=user_api_key_auth_obj,
    ...
    fail_closed_budget_enforcement=general_settings.get("fail_closed_budget_enforcement") is True,
)
```

That call estimates the worst case cost of the request, adds it to every relevant Redis counter,
and raises `BudgetExceededError` if any counter would go over its ceiling. If nothing raises, the
request is forwarded to the provider.

When the response comes back, a logging callback fires. It computes the true cost from the token
counts in the response, then does three things: it appends a row to an in-process list of spend log
rows, it enqueues per-entity spend increments onto in-memory queues, and it replaces the hold with
the true cost in the Redis counters
(`litellm/proxy/hooks/proxy_track_cost_callback.py:490-545`).

A background job wakes every ten seconds or so and pushes the queued increments into Postgres.

So there are three separate stores of "what has been spent", and they are deliberately allowed to
disagree for a while:

| Store | What it holds | How current it is |
| --- | --- | --- |
| Redis spend counters | Running dollar total per key, team, user, organization, tag, and end user | Updated inside the request, so within milliseconds |
| Postgres `spend` columns | The same totals | Behind by one flush interval, about ten to fifteen seconds |
| Postgres `LiteLLM_SpendLogs` | One row per request | Behind by one flush interval |

Enforcement reads Redis. The management API (`/key/info` and friends) reads Postgres. That split is
the direct cause of the bug filed as issue #27735, which is discussed later.

## The data model

The schema lives in `schema.prisma` at the repository root, 1,463 lines, generated into Postgres by
Prisma migrations under `litellm-proxy-extras/litellm_proxy_extras/migrations/`.

Five groups of tables matter for money.

### The entities that carry a spend number and a ceiling

Every entity that can be limited carries its own mutable `spend` column and its own optional
`max_budget`. There is no separate balance table.

`LiteLLM_VerificationToken` is the virtual key (`schema.prisma:416-478`). Simplified:

```prisma
model LiteLLM_VerificationToken {
    token           String   @id      // SHA-256 of the sk-... string
    key_alias       String?
    spend           Float    @default(0.0)
    max_budget      Float?
    budget_duration String?           // "30d", "1mo", and so on
    budget_reset_at DateTime?
    budget_limits   Json?             // several windowed budgets at once
    soft_budget_cooldown Boolean @default(false)
    user_id         String?
    team_id         String?
    organization_id String?
    budget_id       String?
    expires         DateTime?
    last_active     DateTime?
}
```

`LiteLLM_UserTable` (`schema.prisma:234-268`), `LiteLLM_TeamTable`, `LiteLLM_OrganizationTable`
(`schema.prisma:84-105`), `LiteLLM_EndUserTable` (`schema.prisma:573-585`), `LiteLLM_TagTable`
(`schema.prisma:587-599`), and `LiteLLM_TeamMembership` all repeat the same two columns: a mutable
`spend` float and a nullable `max_budget` float, sometimes indirectly through a shared
`LiteLLM_BudgetTable` row.

`LiteLLM_BudgetTable` (`schema.prisma:12-35`) is a reusable ceiling that several entities can point
at. It holds `max_budget`, `soft_budget` (an alerting threshold, not a block), rate limits, a
`budget_duration`, and a `budget_reset_at`. It holds no spend of its own.

None of these are append only. `spend` is incremented in place and set back to zero when a budget
window rolls over.

### The append only table

`LiteLLM_SpendLogs` (`schema.prisma:607-645`) is the one table that is genuinely append only.
Simplified:

```prisma
model LiteLLM_SpendLogs {
  request_id          String @id     // provider response id, else litellm_call_id
  call_type           String
  api_key             String @default("")   // hashed virtual key
  spend               Float  @default(0.0)
  total_tokens        Int    @default(0)
  prompt_tokens       Int    @default(0)
  completion_tokens   Int    @default(0)
  startTime           DateTime
  endTime             DateTime
  model               String @default("")
  model_group         String? @default("")
  custom_llm_provider String? @default("")
  user                String? @default("")
  team_id             String?
  organization_id     String?
  end_user            String?
  session_id          String?
  status              String?
  metadata            Json?  @default("{}")
  @@index([startTime])
  @@index([startTime, request_id])
  @@index([end_user])
  @@index([session_id])
}
```

Note what it does not have. There is no entry type. There is no sign. There is no counterpart
account. Every row is a consumption event. Nothing in the table can represent "50 credits were
granted" or "10 credits were refunded". This table is a usage log that happens to carry a dollar
figure, not a ledger.

### The daily rollups

There are six near-identical daily aggregate tables: `LiteLLM_DailyUserSpend`
(`schema.prisma:734-766`), and the same shape for team, organization, end user, agent, and tag.
Simplified:

```prisma
model LiteLLM_DailyUserSpend {
  id                  String   @id @default(uuid())
  user_id             String?
  date                String                     // "2026-08-03"
  api_key             String
  model               String?
  custom_llm_provider String?
  mcp_namespaced_tool_name String?
  endpoint            String?
  prompt_tokens       BigInt   @default(0)
  completion_tokens   BigInt   @default(0)
  cache_read_input_tokens     BigInt @default(0)
  cache_creation_input_tokens BigInt @default(0)
  spend                        Float @default(0.0)
  prompt_caching_savings_spend Float @default(0.0)
  api_requests        BigInt   @default(0)
  successful_requests BigInt   @default(0)
  failed_requests     BigInt   @default(0)

  @@unique([user_id, date, api_key, model, custom_llm_provider,
            mcp_namespaced_tool_name, endpoint])
}
```

The unique constraint is the whole trick. Writes are upserts against that constraint with
`increment` on every numeric column, so two workers writing the same bucket on the same day add
rather than overwrite (`litellm/proxy/db/db_spend_update_writer.py:1629-1635`).

These tables separate cache read tokens from cache creation tokens, which is exactly the split we
need for our own reporting.

### The leader election table

`LiteLLM_CronJob` (`schema.prisma:938-945`) records which worker is currently allowed to run a
background job. In practice the Redis based lock is used instead, described later.

### What is missing

There is no reservations table. Searching `schema.prisma` for "reserv" returns only two comments
about deleted key and team audit tables. A hold exists only as an increment to a Redis number plus
a Python dictionary in the memory of the worker that made it. That single fact drives most of the
failure modes below.

## How a balance is produced

LiteLLM does not compute a balance from entries. It keeps a stored number and mutates it, in two
places at once.

The authoritative number for enforcement is a Redis counter. `litellm/proxy/proxy_server.py:2004`
creates the cache that holds them:

```python
spend_counter_cache = DualCache(default_in_memory_ttl=UserAPIKeyCacheTTLEnum.in_memory_cache_ttl.value)
```

`DualCache` means "a per process dictionary in front of Redis". The in-memory time to live is 60
seconds (`litellm/proxy/proxy_server.py:1394-1395`).

Reads always try Redis first, on purpose. `_read_spend_counter_estimate`
(`litellm/proxy/proxy_server.py:2323-2361`) explains why in its own docstring: the per process
dictionary only ever sees that process's own increments, so it would mask what other workers
spent. The fallback chain is Redis, then the local dictionary, then a fresh read of the Postgres
row, then a value the caller loaded during authentication.

The Postgres `spend` column is described in the code as a "lagging authoritative floor"
(`litellm/proxy/proxy_server.py:2266-2281`). It is behind because it is only written every ten
seconds or so. When a Redis counter is found to be lower than the Postgres value, the counter is
raised to match, never lowered (`litellm/proxy/proxy_server.py:2233-2263`). The write uses Redis
`SET` with a max semantic so a concurrent increment cannot be clobbered.

The trade off they accepted is explicit. Enforcement is fast and survives Redis restarts poorly.
Reporting is slow and correct. The two are allowed to disagree, and when they do, enforcement wins
and the user sees a rejection that the dashboard cannot explain. Issue #27735 is precisely that:
a key rejected with "Current cost: 10.607, Max budget: 10.0" while `/key/info` reported spend of
3.536 against the same 10.0 ceiling. The issue is still open, with pull request #35150 in flight
(https://github.com/BerriAI/litellm/issues/27735).

## The hold: what is reserved, and how a maximum cost is guessed

The reservation code is `litellm/proxy/spend_tracking/budget_reservation.py`, 1,317 lines.

### Which counters get the hold

`_get_budget_counters` (lines 325-435) builds the list of counters to charge. For one request that
can be as many as nine:

- the key's own counter, `spend:key:<hashed token>`, if the key has a `max_budget` (lines 338-349)
- one counter per windowed budget on the key, `spend:key:<token>:window:<duration>` (lines 350-358)
- the team counter and its windows (lines 360-381)
- the user counter, but only when the request is not a team request (lines 383-399)
- an end user counter, when the caller passed a `user` field (lines 401-407)
- one counter per request tag (lines 409-416)
- a team membership counter, meaning one member's share inside a team (lines 418-425)
- the organization counter (lines 427-433)

The same dollar amount is added to every one of them. They are ceilings applied in parallel, not a
single balance split between levels.

### How the maximum cost is estimated

`estimate_request_max_cost` (lines 901-923) resolves the model, then for each candidate pricing
shape computes a worst case and takes the largest. The per model worst case is `_max_cost_for_cost_info`
(lines 1021-1079):

```python
input_cost_per_token = _to_float(model_info.get("input_cost_per_token"))
output_cost_per_token = _to_float(model_info.get("output_cost_per_token"))
output_cost_per_reasoning_token = _to_float(model_info.get("output_cost_per_reasoning_token"))
cost = 0.0
if input_cost_per_token is not None:
    cost += input_tokens * input_cost_per_token
...
# The reasoning-token share is unknown before the request runs, so reserve every
# output token at the higher of the standard and reasoning rates to avoid
# under-reserving reasoning-heavy requests.
output_rate = max(output_cost_per_token or 0.0, output_cost_per_reasoning_token or 0.0)
```

Input tokens are counted locally, before the call, by running the tokenizer over the messages and
the tool definitions (lines 1190-1222):

```python
if "messages" in request_body:
    return litellm.token_counter(
        model=model,
        messages=request_body.get("messages") or [],
        tools=request_body.get("tools"),
        tool_choice=request_body.get("tool_choice"),
    )
```

Output tokens are the interesting part, and this is the direct answer to "how do you estimate a
streaming response whose length is unknown". LiteLLM does not treat streaming specially at all.
The estimate ignores `stream` entirely. It uses the requested cap, and invents one when the caller
did not supply a cap (lines 1225-1253):

```python
DEFAULT_MAX_OUTPUT_TOKENS_FALLBACK = 16384

def _estimate_output_tokens(request_body, route, model_info) -> int | None:
    if _is_input_only_route(route=route):
        return 0
    requested = None
    for key in ("max_completion_tokens", "max_tokens", "max_output_tokens"):
        requested = _to_int(request_body.get(key))
        if requested is not None:
            break
    model_ceiling = _to_int(model_info.get("max_output_tokens")) or DEFAULT_MAX_OUTPUT_TOKENS_FALLBACK
    if requested is None:
        requested = DEFAULT_MAX_OUTPUT_TOKENS_FALLBACK
    return min(requested, model_ceiling)
```

The comment above that code names both reasons for the clamp. First, an unbounded request still
needs a finite reservation or the hold cannot bound concurrent spend. Second, a hostile caller
must not be able to send `max_tokens=999999999` and pin the counter at the ceiling, denying service
to everyone else on the same team.

The estimate is then multiplied by `n` or `best_of`, whichever is larger (lines 1276-1282), and
image generation requests take a different path that prices `n` images at the per image rate
(lines 1082-1117).

Two things this estimate does not do, both of which matter to us. It does not consider prompt
caching, so a repeated 23,600 token prefix is reserved at the full input rate rather than the cache
read rate. And it does not consider that a chat turn will usually produce a few hundred output
tokens rather than the model's maximum.

Put our own numbers through it. A `gemini-2.5-flash` call with our 23,600 token replayed context
and no explicit `max_tokens` reserves:

- input: 23,600 x 3e-07 = 0.00708 dollars
- output: 16,384 x 2.5e-06 = 0.04096 dollars
- total hold: about 0.048 dollars

The true cost of that call, if the prefix is a cache hit and the model emits 500 tokens, is
23,600 x 3e-08 plus 500 x 2.5e-06, which is about 0.002 dollars. The hold is roughly twenty four
times the settled amount. That is fine when the balance is large. It is not fine when the balance
is small, because the hold, not the spend, is what blocks the next request.

### Applying the hold

The hold is applied counter by counter in `reserve_budget_for_request` (lines 194-240). For each
counter it appends a small dictionary to a list, then increments the Redis number:

```python
entry = _counter_to_reservation_entry(counter=counter, reserved_cost=reservation_cost)
applied_entries.append(entry)
reserved_value = await _reserve_counter(counter=counter, reservation_cost=reservation_cost)
...
if current_spend > counter.max_budget:
    reservation_cost = await _apply_over_budget_reservation_policy(...)
```

The entry is just this (lines 850-860):

```python
{
    "counter_key": counter.counter_key,
    "entity_type": counter.entity_type,
    "entity_id": counter.entity_id,
    "reserved_cost": reserved_cost,
    "applied_adjustment": 0.0,
}
```

The whole reservation object returned to the caller is a plain dictionary
(lines 246-251), carrying the total reserved, the per counter entries, a `finalized` flag, and the
input-only portion of the cost. It lives in the worker's memory for the life of the request and is
never written anywhere durable.

### What happens when a counter is already over

`_apply_over_budget_reservation_policy` (lines 104-144) has three outcomes, and the middle one is
clever. If the entity opted into throttling instead of blocking, the hold on that one counter is
released and the request proceeds, slowed by the rate limiter. Otherwise the code computes how much
headroom actually remained before this hold was applied:

```python
remaining_before_reservation = counter.max_budget - (current_spend - reservation_cost)
if remaining_before_reservation > 1e-12:
    await _resize_applied_reservation(
        entries=applied_entries,
        current_reserved_cost=reservation_cost,
        new_reserved_cost=remaining_before_reservation,
    )
    return remaining_before_reservation
raise litellm.BudgetExceededError(...)
```

So a request that would overshoot is not rejected outright. The hold shrinks to exactly the money
that is left, on every counter already touched, and the loop continues with the smaller number.
The request is allowed to run and can overspend by whatever the provider actually charges beyond
that remainder. Only a genuinely empty budget raises.

This is a deliberate choice to favour letting the last request through over strictly never
exceeding the ceiling. It is worth noting because our situation is the opposite: a free tier funded
by us has no recourse if it overshoots.

## The settle: replacing the estimate with the truth

Settlement lives in the same file, in `reconcile_budget_reservation` (lines 254-271), and is driven
from the cost callback.

The mechanism is a delta applied to the same Redis counter
(`_set_reserved_entry_actual_cost`, lines 742-787):

```python
reserved_cost = _get_entry_reserved_cost(entry=entry, default_reserved_cost=default_reserved_cost)
target_adjustment = actual_cost - reserved_cost
applied_adjustment = float(entry.get("applied_adjustment") or 0.0)
adjustment = target_adjustment - applied_adjustment
if adjustment == 0:
    return
if await _counter_can_apply_adjustment(counter_key=counter_key, adjustment=adjustment):
    await _increment_spend_counter_cache(counter_key=counter_key, increment=adjustment)
elif reseed_on_inconsistent:
    await reseed_spend_counter_from_db(counter_key=counter_key)
...
entry["applied_adjustment"] = target_adjustment
```

Three details are worth pulling out.

The adjustment is computed against what has already been applied, so calling reconcile twice with
the same actual cost is a no-op the second time. That is an idempotency guard scoped to one
in-memory dictionary, not to the database.

`_counter_can_apply_adjustment` (lines 790-805) refuses a negative adjustment that would drive the
counter below zero. If the counter has been flushed or reset since the hold was applied, the delta
is meaningless, so the code reseeds from Postgres instead of blindly subtracting. An earlier
version deleted the counter, and the comment records what that cost: "deleting it is what left
budgets unenforced after a Redis reload."

Settlement is called from four places, so that every exit path from a request releases the hold:

- success, from the cost callback (`litellm/proxy/proxy_server.py:2384-2392`, via
  `increment_spend_counters`)
- provider or proxy failure, from `async_post_call_failure_hook`
  (`litellm/proxy/hooks/proxy_track_cost_callback.py:57-67`), which settles to zero
- database write failure, which also settles to zero
  (`litellm/proxy/hooks/proxy_track_cost_callback.py:508-515`)
- client disconnect or timeout (`litellm/proxy/common_request_processing.py:2894-2897`)

The cancellation path is the most thoughtful piece of the file, and its docstring
(`budget_reservation.py:280-310`) is worth reading in full because the reasoning applies to us
unchanged:

> A client disconnect or timeout cancels the request task, which surfaces as CancelledError /
> GeneratorExit rather than a normal exception, so neither the success cost callback nor the
> failure hook runs and the pre-call reservation is never reconciled. Left alone it pins the spend
> counter above real spend and 429s subsequent requests until the counter's TTL expires.
>
> Reconcile to the request's input-token cost rather than refunding to zero: by the time a request
> is cancelled in-flight the provider call was already dispatched, so the input tokens were billed
> even if no chunk reached the client. Refunding to zero would let a caller abort pre-token to dodge
> that charge.

The implementation wraps the settle in `asyncio.shield` so it completes even though the surrounding
task is being cancelled, and the `finalized` flag makes a double settle harmless.

## Concurrency: what stops two requests spending the last dollar

This is the part worth copying verbatim, because it is simple and it is correct.

The reservation is applied with a single atomic Redis operation. `_increment_spend_counter_cache`
(`litellm/proxy/proxy_server.py:2759-2780`):

```python
async def _increment_spend_counter_cache(counter_key: str, increment: float):
    if spend_counter_cache.redis_cache is not None:
        try:
            current_value = await spend_counter_cache.redis_cache.async_increment(
                key=counter_key,
                value=increment,
                refresh_ttl=True,
            )
        except Exception:
            await _invalidate_spend_counter(counter_key=counter_key)
            raise
        spend_counter_cache.in_memory_cache.set_cache(key=counter_key, value=current_value)
        return current_value
    return await spend_counter_cache.async_increment_cache(key=counter_key, value=increment, refresh_ttl=True)
```

`async_increment` is a Redis `INCRBYFLOAT` (`litellm/caching/redis_cache.py:952`):

```python
result = await _redis_client.incrbyfloat(name=key, amount=value)
```

`INCRBYFLOAT` returns the value after the increment. The admission decision uses that returned
value, not a separate read (`budget_reservation.py:218-225`):

```python
if reserved_value is not None:
    current_spend = reserved_value
else:
    ...
if current_spend > counter.max_budget:
    reservation_cost = await _apply_over_budget_reservation_policy(...)
```

That is the whole concurrency mechanism. There is no lock, no transaction, no compare and swap
loop. Two requests arriving at the same instant both increment; Redis serialises them; each sees a
different post-increment total; only one of them can see a total under the ceiling. It is a single
round trip and it is race free by construction.

The cold start case is handled with the same trick. When a counter does not exist yet, the code
seeds it from the Postgres row using an increment rather than a set, and the comment explains why
(`litellm/proxy/proxy_server.py:2636-2640`):

> Seed counter via async_increment_cache (not async_set_cache) to avoid a check-then-set race: if
> two pods cold-start simultaneously, both may see the counter as absent and seed it. Using
> increment means the worst case is over-counting (conservative, blocks slightly early) rather than
> under-counting (would allow overspend).

Reseeding from the database is coalesced with a per counter asyncio lock so a thundering herd of
requests produces one query, not one per request (`litellm/proxy/db/spend_counter_reseed.py:56-72`).

The Postgres side handles concurrency differently, because there the risk is a deadlock rather than
a lost update. All spend increments for one entity type are applied inside one transaction, sorted
by primary key so every worker takes locks in the same order
(`litellm/proxy/db/db_spend_update_writer.py:1106-1129`):

```python
async with prisma_client.db.tx(timeout=timedelta(seconds=60)) as transaction:
    async with transaction.batch_() as batcher:
        # Sort by ID for consistent lock ordering across pods to prevent deadlocks.
        for user_id, response_cost in sorted(user_list_transactions.items()):
            batcher.litellm_usertable.update_many(
                where={"user_id": user_id},
                data={"spend": {"increment": response_cost}},
            )
```

Retries use randomised exponential backoff, with a comment noting that two deadlocked transactions
retried after the same delay just deadlock again
(`litellm/proxy/db/db_spend_update_writer.py:1288-1295`).

## Idempotency: what exists and what does not

There is exactly one durable idempotency guarantee in the system, and it is on the log table, not
on the charge.

Spend log rows are written with duplicate keys skipped
(`litellm/proxy/utils.py:5790-5791`):

```python
await repo.table.create_many(data=rows, skip_duplicates=True)
```

`request_id` is the primary key of `LiteLLM_SpendLogs`, so this compiles to
`INSERT ... ON CONFLICT DO NOTHING`. Writing the same row twice inserts once.

But `request_id` is not a caller supplied idempotency key. It is the provider's response
identifier, falling back to a UUID generated by LiteLLM for that attempt
(`litellm/proxy/spend_tracking/spend_tracking_utils.py:179`):

```python
id = cast(str | None, response_obj.get("id")) or cast(str | None, kwargs.get("litellm_call_id"))
```

So the guard protects against LiteLLM writing the same completed call twice. It does nothing about
the case we actually care about, which is a client that times out and retries. That retry becomes a
second provider call with a second response identifier, and it is charged twice, correctly, because
it genuinely cost twice.

The per entity `spend` increments have no idempotency at all. They are `UPDATE ... SET spend =
spend + x` statements aggregated from an in-memory queue. If the same aggregate were applied twice
the spend would double, and nothing would detect it. What prevents that is not a key, it is the
fact that each aggregate is removed from its queue before the write is attempted, so a failure
loses it rather than duplicating it. They chose under-counting over double counting.

The daily rollup tables get idempotency of a weaker kind. The unique constraint on
`(entity, date, api_key, model, provider, tool, endpoint)` means concurrent writers merge into one
row through an upsert with increments rather than creating duplicates
(`schema.prisma:758`, `litellm/proxy/db/db_spend_update_writer.py:1629-1635`). That protects the
shape of the table, not the amount.

The in-memory reconcile guard described earlier (`applied_adjustment` and the `finalized` flag) is
the only protection against settling a hold twice, and it dies with the process.

## What happens if the proxy dies mid request

This is the weakest part of the design and the most important one for us to understand before we
copy anything.

A hold exists in two places. The Redis counter has been incremented. A Python dictionary in one
worker's memory records by how much and on which counters. If that worker dies between the two, the
dictionary is gone and nothing will ever settle the hold. There is no record anywhere that a hold
was taken, so no recovery job can find it.

The only thing that eventually clears it is the Redis key expiring. Spend counters use the
`RedisCache` default time to live, which is 60 seconds, because `litellm.default_redis_ttl` is
`None` by default (`litellm/__init__.py:381`, `litellm/caching/redis_cache.py:333-335`,
`litellm/caching/base_cache.py:23`). When the key expires, the next request reseeds the counter
from the Postgres `spend` column and the leaked hold disappears.

But the increment is made with `refresh_ttl=True` (`litellm/proxy/proxy_server.py:2765`), which
resets the 60 second clock on every write. So the expiry only fires after 60 seconds during which
nobody touched that counter. A busy key never goes quiet, so its leaked hold persists for as long
as traffic continues. And the repair path only ever raises a counter toward the Postgres value, it
never lowers one (`litellm/proxy/proxy_server.py:2233-2263`, using a max semantic write). Nothing
in the codebase lowers an inflated counter.

To answer the question directly: yes, a reservation can leak, and on a busy key it can leak for an
unbounded time. It is not a permanent leak in the strict sense, because 60 seconds of quiet clears
it, but there is no bound on how long a counter stays busy.

The visible symptom of a leaked hold is exactly issue #27735: the key is refused because the Redis
counter says 10.607, while Postgres and therefore `/key/info` say 3.536.

LiteLLM's answer to the "what if Redis or the database is unreachable" version of this problem is a
flag rather than a fix. `fail_closed_budget_enforcement` (read at
`litellm/proxy/proxy_server.py:2133-2134`) changes three behaviours. A reservation that cannot be
written to Redis rejects the request with HTTP 503 instead of proceeding
(`budget_reservation.py:65-78, 214-216`). A spend read that could only be answered from a per
process cache rejects rather than admitting (`litellm/proxy/proxy_server.py:2223-2229`). And every
read re-checks the Postgres floor rather than trusting a healthy looking counter
(`litellm/proxy/proxy_server.py:2199-2212`). The default is off, so the default behaviour is to let
the call through when the enforcement machinery is unavailable.

## How much spend can be lost, and is the loss bounded

Spend reaches Postgres through a chain of buffers. Each link can drop.

The first link is an in-process `asyncio.Queue` per entity type
(`litellm/proxy/db/db_transaction_queue/spend_update_queue.py:24`), with a maximum size of 1,000
items (`litellm/constants.py:265`). At 800 items the queue collapses itself by summing entries with
the same entity (`spend_update_queue.py:44-56`, `litellm/constants.py:272`), so it never overflows
in practice. It is drained by a background job every `PROXY_BATCH_WRITE_AT` seconds plus a random 0
to 5 second offset. The default is 10 seconds (`litellm/constants.py:1489`,
`litellm/proxy/proxy_server.py:8096`).

If the process dies, everything in that queue is lost. The bound is time based, not count based:
you lose whatever that worker accrued in the last flush interval. Under heavy traffic that can be a
large dollar figure, and nothing records that it happened.

The second link is optional and is switched on with `use_redis_transaction_buffer`
(`litellm/proxy/db/db_transaction_queue/redis_update_buffer.py:67-82`). With it on, each worker
pushes its aggregated transactions as a JSON string onto a Redis list called
`litellm_spend_update_buffer` (`litellm/constants.py:256`) using `RPUSH`. Only one worker then
writes to Postgres, chosen by a Redis lock acquired with `SET key value NX EX 60`
(`litellm/proxy/db/db_transaction_queue/pod_lock_manager.py:66-82`,
`litellm/constants.py:1477`) and released by an atomic compare-and-delete Lua script so a stale
owner cannot delete a lock someone else reacquired.

That link has one carefully handled failure and one unhandled one.

The handled failure is a `RPUSH` that raises. Because the in-memory queues were already drained,
the aggregated data would vanish, so the code puts it back
(`redis_update_buffer.py:257-282`):

```python
except Exception as e:
    # The in-memory queues were already drained above. If we let the
    # exception propagate without restoring, the aggregated spend is
    # permanently lost. Re-enqueue so the next scheduler tick retries.
    ...
    await self._restore_spend_updates_to_in_memory_queues(...)
```

The unhandled one is the leader popping from Redis and then failing to write to Postgres. The list
is drained with `LPOP` up to 100 entries at a time (`litellm/constants.py:263`) before the database
write is attempted, and the error handler says so plainly
(`litellm/proxy/db/db_spend_update_writer.py:889-895`):

```python
except Exception as e:
    spend_log_error(
        "Spend tracking - failed to commit spend updates from Redis to DB. "
        "Data already popped from Redis may be lost. Error: %s",
        str(e), exc=e,
    )
```

The third link is the spend log list. Rows are taken off the list before the insert
(`litellm/proxy/utils.py:5436-5440`), up to 10,000 per interval. If Postgres rejects a batch on the
data itself, the batch is bisected so that only the offending rows are dropped, and there is a
budget on how many failed inserts that isolation may issue before the remainder is dropped wholesale
(`litellm/proxy/utils.py:5763-5824`).

Putting it together. Any single failure loses at most one flush interval of spend, roughly ten to
fifteen seconds. Repeated failures lose repeated intervals, and there is no outbox table, no status
column, and no retry record, so the loss is silent and unbounded across time. The design cannot
tell you afterwards how much it lost.

There is a second-order effect worth naming. The Redis counter still holds the correct total right
after a lost flush, so enforcement stays right for a while. But when that counter next expires, it
is reseeded from a Postgres row that is now permanently short, and the lost spend becomes invisible
to enforcement too.

## How prompt caching is priced

This matters more to us than to almost any other LiteLLM user, because our harness replays about
23,600 tokens on every model call.

### Reading the token counts out of the response

Providers report cached tokens in different places, and LiteLLM normalises them into one usage
object. The parse is `_parse_prompt_tokens_details`
(`litellm/litellm_core_utils/llm_cost_calc/utils.py:456-472`):

```python
cache_hit_tokens = cast(int | None, getattr(usage.prompt_tokens_details, "cached_tokens", 0)) or 0
cache_creation_tokens = (
    cast(int | None,
        getattr(usage.prompt_tokens_details, "cache_write_tokens", 0)
        or getattr(usage.prompt_tokens_details, "cache_creation_tokens", 0),
    ) or 0
)
```

The spend writer has its own copy of the same logic for the daily rollups, and its docstrings name
the providers (`litellm/proxy/db/db_spend_update_writer.py:71-93`):

```python
def _extract_cache_read_tokens(usage_obj: dict) -> int:
    """
    Anthropic: top-level cache_read_input_tokens field.
    OpenAI-compatible (moonshotai, openai, deepseek, etc.): prompt_tokens_details.cached_tokens.
    """
```

Google's Gemini reports `cachedContentTokenCount` in its usage metadata, mapped at
`litellm/llms/vertex_ai/gemini/vertex_and_google_ai_studio_gemini.py:1780-1781`.

### Pricing them

Rates are resolved once per request by `_get_token_base_cost`
(`litellm/litellm_core_utils/llm_cost_calc/utils.py:202-234`), which reads four separate fields
from the model price table: `input_cost_per_token`, `output_cost_per_token`,
`cache_creation_input_token_cost`, and `cache_read_input_token_cost`. It also handles a fifth,
`cache_creation_input_token_cost_above_1hr`, for Anthropic's longer lived cache.

The input cost is then assembled from parts rather than from a single token count
(`litellm/litellm_core_utils/llm_cost_calc/utils.py:566-614`):

```python
prompt_cost = float(prompt_tokens_details["text_tokens"]) * prompt_base_cost
### CACHE READ COST
prompt_cost += float(prompt_tokens_details["cache_hit_tokens"]) * cache_read_cost
...
### CACHE WRITING COST
if prompt_tokens_details["cache_creation_tokens"] or ...:
    prompt_cost += calculate_cache_writing_cost(...)
```

There is a guard against double counting that we would have hit ourselves. Some providers report
`text_tokens` as the full prompt including the cached part, which would charge the cached tokens
twice. LiteLLM detects the overlap and recomputes the uncached remainder
(`litellm/litellm_core_utils/llm_cost_calc/utils.py:737-745`):

```python
total_details = text_tokens + cache_hit + audio_tokens + cache_creation + image_tokens + video_tokens
has_double_counting = cache_hit > 0 and total_details > usage.prompt_tokens
if (text_tokens == 0 and prompt_tokens_details["image_count"] == 0) or has_double_counting:
    text_tokens = usage.prompt_tokens - cache_hit - audio_tokens - cache_creation - image_tokens - video_tokens
    text_tokens = max(text_tokens, 0)
```

Above certain prompt sizes the rates change, and the cache rates change with them. Gemini 2.5 Pro
prices a cache read at 1.25e-07 below 200,000 tokens and 2.5e-07 above, and LiteLLM resolves that
tier for cache reads and cache writes separately, not just for normal input tokens
(`litellm/litellm_core_utils/llm_cost_calc/utils.py:296-330`).

### Reporting the saving

There is a small module whose only job is to turn caching into a number a dashboard can show
(`litellm/proxy/spend_tracking/savings.py:47-60`):

> Compression savings price the tokens compression removed at the model's input rate. Prompt-caching
> savings price the cache-read tokens at the difference between the input rate and the discounted
> cache-read rate.

The result lands in `prompt_caching_savings_spend` on every daily rollup table. If a model has no
separate cache read price, the saving computes to zero rather than raising.

### The gap

Pricing after the fact is complete and careful. Estimating before the fact ignores caching
entirely. The reservation prices every input token at the full rate
(`budget_reservation.py:1061-1066`). For our workload that inflates the hold on the input side by
about ten times, on top of the output side already being inflated by assuming the maximum output
length.

## What else the design carries

**Recurring budgets, not expiring credit.** A budget can carry a `budget_duration` and a
`budget_reset_at`. A scheduled job finds rows whose reset time has passed and writes `spend = 0`
plus the next reset date (`litellm/proxy/common_utils/reset_budget_job.py:400-410`). It also
deletes the corresponding Redis counter so enforcement picks up the reset immediately
(`reset_budget_job.py:486, 565, 646`). The old total is destroyed. Only `LiteLLM_SpendLogs` and the
daily rollups remember it.

**No refunds.** A failed call settles the hold to zero, which is a release, not a refund, because
nothing was ever charged. There is no way to give money back after a call has settled. A support
person facing "we double charged this customer" would have to edit the `spend` column by hand.

**No credit lots and no spending order.** There is one number per entity. There is no way to say
"burn the promotional grant before the purchased one", because there are no grants at all. Budgets
are ceilings on consumption, not deposits of value.

**Negative balances are impossible by construction and overshoot is possible by design.** Spend
counts up toward a ceiling; there is no balance to go negative. Overshoot happens in two ways: the
resize path admits the last request against whatever headroom remains and lets it cost more, and
the settle path can raise the counter above the ceiling when the true cost exceeded the estimate.

**Soft budgets are alerts.** `soft_budget` on `LiteLLM_BudgetTable` and `soft_budget_cooldown` on
the key drive Slack notifications, not refusals.

**Budget fallbacks.** A key can carry `budget_fallbacks`, a map from a model to a list of cheaper
models to try when that model's own budget is exhausted, for example
`{"gpt-4o": ["gpt-4o-mini"]}` (`litellm/proxy/management_endpoints/key_management_endpoints.py:1575`).
This is a product idea worth remembering: when a user runs out, degrade instead of refusing.

**No reconciliation against the provider.** There is nothing in the codebase that compares
LiteLLM's totals against a provider invoice. Cost is computed from the model price table shipped in
the repository (`model_prices_and_context_window.json`), so LiteLLM's number is an independent
estimate of what the provider will bill, not a copy of it. Any drift between the two is invisible.

## The licence boundary

The root `LICENSE` file states the split in its first four lines:

> Portions of this software are licensed as follows:
>
> * All content that resides under the "enterprise/" directory of this repository, if that directory
>   exists, is licensed under the license defined in "enterprise/LICENSE".
> * Content outside of the above mentioned directories or restrictions above is available under the
>   MIT license as defined below.

`enterprise/LICENSE.md` is a commercial licence. It permits reading and modifying for development
and testing, and forbids production use without a paid subscription, and forbids copying,
publishing, distributing, or selling.

What is inside `enterprise/` is 139 Python files covering single sign on and custom SSO handlers,
audit logging endpoints, "managed files" and managed vector stores, a large library of secret
detection plugins (roughly one file per third party credential format), guardrail integrations such
as Aporia, Llama Guard, LLM Guard, and OpenAI moderation, blocked user and banned keyword hooks,
PagerDuty alerting, transactional email, a project management endpoint, and enterprise user
interface assets.

The budget machinery is entirely outside that directory. Every file cited in this document lives
under `litellm/` and is MIT licensed. A search of `enterprise/` for any reference to the spend
queue, the budget reservation module, or the spend counter helpers returns nothing. The only budget
related code in `enterprise/` is input validation on a project creation endpoint, which checks that
`max_budget` is not negative and that `soft_budget` is below `max_budget`
(`enterprise/litellm_enterprise/proxy/management_endpoints/project_endpoints.py:109-135`).

So we may read, adapt, and ship anything from the parts of LiteLLM that matter to us, subject to
the MIT attribution requirement. We must not copy from `enterprise/`, and we have no reason to.

## Judgement for our situation

### What we should copy directly

**The atomic increment as the admission gate.** One `INCRBYFLOAT` against a Redis counter, using
the returned post-increment value as the decision, is the entire concurrency answer. It is one
round trip, it has no race, and it needs no lock. We should copy this shape exactly, including the
detail of seeding a cold counter with an increment rather than a set so two workers cold starting
together over-count instead of under-counting.

**Hold, then settle with a delta.** Reserve a worst case, then apply `actual - reserved` after the
response. Track what has already been applied so a repeated settle is a no-op. That is the correct
shape for a cost that is unknown until the work finishes, and it is small enough to write in an
afternoon.

**Settling on every exit path, including cancellation.** The client disconnect case is not obvious
and it is the one that will bite us, because our agent runs are long and users close tabs. Copy the
`asyncio.shield` pattern and copy the decision to settle a cancelled call to the input token cost
rather than to zero. Our sandbox dispatches the provider call, so the input tokens are spent
whether or not the user sees the answer.

**The daily rollup table with a unique constraint and increment upserts.** This gives per day, per
organization, per model reporting without scanning a log table, and it merges concurrent writers
safely. Copy the column list too, in particular the separate `cache_read_input_tokens` and
`cache_creation_input_tokens` columns. We will want to know how well caching is working.

**The cost calculator's treatment of caching.** We do not need to write this. LiteLLM's pricing
data and its `generic_cost_per_token` function are MIT licensed, handle the cache read and cache
write split per provider, handle the tier changes above 200,000 tokens, and already carry the guard
against providers that double count cached tokens inside `text_tokens`. We should either depend on
the `litellm` package for pricing or lift that function with attribution. Writing our own is the
kind of work that looks small and is not.

**The `savings` idea.** Recording what caching saved, in dollars, per day per organization, is
almost free once the token counts are already in the rollup table, and it directly measures our
largest cost lever.

### What we should simplify

**Collapse nine counters to one.** LiteLLM reserves against key, key windows, team, team windows,
user, end user, tags, team membership, and organization. We have one thing to limit: the
organization's credit balance. One counter, one increment, one settle. The multi-scope loop, the
partial resize logic, and the throttle exemption all exist to serve a permission model we do not
have.

**Drop the "admit the last request against whatever is left" behaviour.** LiteLLM shrinks the hold
to the remaining headroom and lets the request run, which means the ceiling can be exceeded by the
provider's actual charge. Their users are paying their own provider bills, so a small overshoot is
their problem. Ours is our problem. Refuse when the hold does not fit, and tell the user their
balance is exhausted.

**Estimate the hold with cache awareness and a realistic output length.** A blind hold of 16,384
output tokens plus 23,600 uncached input tokens is about 0.048 dollars for a call that settles near
0.002 dollars. That would let a user with a small grant run only a handful of concurrent calls. Two
cheap corrections fix most of it. Price the replayed prefix at the cache read rate when the request
carries a cache marker, and use a configured typical output length rather than the model maximum,
accepting that a rare long response settles above the hold. Keep the clamp against a hostile
`max_tokens`, because a user controls the agent instructions inside our sandbox and therefore
controls the request body.

**Do not build the Redis transaction buffer or the leader lock in the first version.** They exist to
solve Postgres deadlocks above roughly 1,000 requests per second
(`litellm/proxy/db/db_spend_update_writer.py:912`). We run on docker compose on a small number of
containers. A direct write per settled call, or a ten second batched write from a single writer
process, is enough. The batching machinery, the lock, and the buffer restore path together are
several hundred lines that buy us nothing yet, and they are the source of most of LiteLLM's silent
loss.

### What would be wrong for us

**The mutable `spend` column as the source of truth.** This is the single decision we must not
copy. LiteLLM stores a number and mutates it, then destroys it when a budget window resets. It has
no entry for a grant, no entry for a purchase, no entry for a refund, and no way to answer "where
did these credits come from". That model cannot express what we have already decided to build:
credits arriving as grants, purchases, and earnings, and leaving as debits.

Retrofitting a ledger onto a mutable counter is the painful migration we said we would avoid. It
means backfilling entries from a log table that never recorded the arrivals, reconciling every
existing balance by hand, and rewriting every read path. We should write entries from day one.

The good news is that the two designs compose cleanly. Keep the Redis counter, but define it as a
cache of the derived balance rather than as the truth. A settled debit writes an append only row in
Postgres and adjusts the counter. A grant writes a row and adjusts the counter. If the counter is
ever lost, it is rebuilt by summing the rows, which is a stronger recovery story than LiteLLM has,
because their reseed reads a number that may itself be wrong.

**Losing spend silently.** LiteLLM's queues drop data on failure and log a line. That is acceptable
when the operator is spending their own provider budget and the worst case is a slightly low
report. We are handing out money we paid for, and the earning path means a balance is something a
contributor worked for. A dropped debit is money given away. A dropped credit is a broken promise.
Write the entry synchronously in the same request that settles, and if we later need batching, put
the entries in an outbox table with a status column so that nothing is ever only in memory.

**Holds that exist only in memory.** LiteLLM's hold is a Python dictionary plus a Redis increment,
with no durable record, which is why a crashed worker leaves an inflated counter that only 60
seconds of silence can clear. Our agent calls are long and our balances are small, so a leaked hold
is much more visible to us than to them. Write the hold as a row with a state and a creation time.
A sweeper that expires holds older than a few minutes is perhaps thirty lines, and it turns an
unbounded leak into a bounded one.

**Trusting an in-process idempotency guard.** The `applied_adjustment` and `finalized` fields work
only while the worker lives. If we ever settle from a background job, a retry, or a second process,
that guard is gone. Put the request identifier on the debit row with a unique constraint, so
settling twice is caught by the database rather than by a dictionary.

**Treating a budget as a ceiling rather than a balance.** LiteLLM asks "has this key spent more than
its limit". We need to ask "does this organization have enough credits left". Those look the same
until you add expiring grants, purchased credits that must outlive promotional ones, and refunds.
Model it as a balance from the start.

### The shortest correct first version, expressed as a diff from LiteLLM

Take LiteLLM's request path and its Redis counter unchanged. Replace its storage layer.

Keep: the atomic increment gate, the estimate then settle flow, settlement on all four exit paths
including cancellation, the daily rollup table with increment upserts, and the cost calculator with
its cache aware pricing.

Change: one counter per organization instead of nine per request. A durable `holds` row alongside
the Redis increment, with a sweeper. An append only `ledger_entries` table where grants, purchases,
earnings, and debits all live, with a unique constraint on the request identifier for debits. The
Redis counter redefined as a cache of the sum of those entries, rebuildable at any time.

Drop: the Redis transaction buffer, the leader lock, the multi-scope reservation loop, the partial
resize, the throttle exemption, and the in-memory spend queues.

That leaves a first version small enough to build quickly, with the one structural decision that is
expensive to change made correctly at the start.
