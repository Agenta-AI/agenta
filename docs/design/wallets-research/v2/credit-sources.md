# Credit sources

Release plan step 1.3. The wallet receives credit from five sources. All amounts are in
micro-dollars (musd). 1 credit = 1 cent = 10,000 musd.

| Source | `credit_kind` | Amount | Expiry | Spend priority | Idempotency key |
| --- | --- | --- | --- | --- | --- |
| Signup | `signup_grant` | $5 (500 credits) | 12 months | 20 | `award:signup:organization:{id}` |
| Daily free credits | `daily_free` | 75 credits | next UTC midnight | 5 | `award:daily_free:organization:{id}:reference:{UTC date}` |
| Monthly credits | `plan_allowance` | Pro 2,900, Business 29,900 credits | billing period end | 10 | `plan_allowance:organization:{id}:period:{period start}` |
| Top-up | `purchase` | the pack's credits | 12 months | 70 | `purchase:checkout_session:{session id}` |
| Starter-credits transfer | `starter_credits` | the proxy key's remaining budget | 12 months | 20 | `starter_credits:organization:{id}` |

Every source mints through `WalletsDAO.award_credit`. Its replay guard is the unique index
`uq_wallet_credits_org_award_key` on `data.references.award_idempotency_key`, under the
organization's general-balance row lock. A redelivered webhook or a concurrent admission
returns the first credit and writes nothing.

Settlement spends the lowest priority first, then the earliest expiry. The daily credit
expires soonest, so it goes first. A purchase is paid for and lasts longest, so it goes last.

## Decided numbers

All decided by Mahmoud on 2026-10-02 (pricing option E, and the defaults he approved that
night):

- Signup grant: $5 per new organization (was $1). `SIGNUP_GRANT_AMOUNT_MUSD` in
  `ee/src/core/wallets/grants.py`. The backfill job awards through the same rule.
- Daily free credits: 75 a day on the free plan. `DAILY_FREE_CREDITS_MUSD` in `grants.py`;
  the eligible plans are `DAILY_FREE_CREDIT_PLANS` in `plans.py`.
- Monthly credits equal the plan price: Pro $29, Business $299. `plans.py`.
- Top-up packs: $10 = 1,000 credits, $25 = 2,500, $100 = 10,000. Paid plans only.
  `TOP_UP_PACKS` in `ee/src/core/wallets/purchases.py`.
- Purchased credit expires after 12 months.

## Daily free credits

`WalletsService._spendable` runs on every wallet admission (`check` and `covers`: the gateway,
sandbox and managed-tool admission points). Before it reads the balance, it grants today's
daily credit when the organization's plan is in `DAILY_FREE_CREDIT_PLANS`.

- Only the admission instance built in `ee/src/main.py` has a `plan_reader`, so only it
  grants. The settlement worker and the jobs never grant daily credit.
- The plan is read from the `subscriptions` table, once per organization per day per API
  process. An in-process set remembers which organizations are done today. The idempotency
  key, not the set, guarantees one grant per day.
- A failed plan read or grant is logged and never fails the admission. The grant has its
  own 0.5 s bound inside the admission, so a stalled plan read or award lock cannot spend the
  admission's deadline. Past it, the admission reads the balance without the grant, and the
  next admission retries.
- An organization in wallet mode `off` is not admitted through the wallet, so it gets no
  daily credit.
- The credit expires at the next UTC midnight, judged by the database clock like every
  expiry. Nothing rolls over.

Limits, accepted:

- An organization that switches to the free plan during a day gets its first daily credit
  the next day in a process that already checked it today.
- The balance shown in the app does not include today's credit until the first admission of
  the day.

## Monthly credits

`invoice.payment_succeeded` in `BillingRouter.handle_events` grants the period before it
resumes the subscription.

- Only `billing_reason` `subscription_create` (the first period) and `subscription_cycle`
  (each renewal) open a period. A plan switch's proration invoice (`subscription_update`) or
  a manual invoice grants nothing, so a switch never grants twice in one period.
- An invoice with `total` 0 grants nothing. A reverse-trial period and a fully discounted
  period are not paid for. The first paid invoice after the trial is a `subscription_cycle`
  and grants.
- The period is the latest-starting period among the invoice's recurring subscription lines.
  A renewal also carries usage lines billed in arrears for the period that just ended;
  prorations and one-off invoice items are ignored. Both webhook line shapes are read (before
  and after Stripe API version 2025-03-31). An invoice without such a line fails the webhook.
- The plan comes from the invoice's subscription metadata, which Stripe snapshots when it
  finalizes the invoice. A plan switch rewrites the subscription's `plan` metadata. So a
  renewal grants the plan that was paid for, even when its webhook arrives after a later
  switch or before `customer.subscription.created`. An unknown plan fails the webhook.
  A subscription switched before this change still carries its old `plan` metadata until its
  next switch.
- Requires `STRIPE_WEBHOOK_SECRET`: an unsigned invoice event fails instead of granting.
- A failed grant fails the webhook with HTTP 500, and Stripe redelivers. The redelivered
  grant is a no-op when the first attempt did write.
- Gated by `AGENTA_WALLETS_ENABLED`, like the signup grant.

A plan change writes nothing to the wallet (open-designs items 22 and 23). It only changes
which plan the next renewal grants.

## Top-ups

`POST /billing/stripe/topups/?pack=<code>&success_url=<url>` (permission `EDIT_BILLING`)
starts a one-time Stripe Checkout (`mode=payment`) for a pack. It refuses with 400 an
organization without an active paid Stripe subscription, and with 404 when the wallet is off.
The session metadata carries `organization_id`, `target`, `purpose=credit_top_up` and `pack`.

Both the route and the grant require `STRIPE_WEBHOOK_SECRET`. Without it the route answers
404, and an unsigned top-up event is refused, because anyone could post one.

`checkout.session.completed` grants the credit when the session is a paid top-up:
`mode=payment`, `purpose=credit_top_up`, `payment_status=paid`. The pack comes from the
metadata, and the session's `currency` and `amount_subtotal` must match it; a mismatch is
logged as an error and answered with 400, and grants nothing. Metadata is written only by
our server through the secret key, and the webhook signature is verified, so a client cannot
forge it.

**Operator step:** the Stripe webhook endpoint must subscribe to `checkout.session.completed`
in addition to the events it already receives. Without it, a top-up is charged and never
credited.

## Starter-credits transfer

`api/entrypoints/migrate_starter_credits_to_wallet.py` is a one-off job. It lists the
starter-credits program team's keys on the proxy (`/key/list` with full objects) and keeps
the keys whose metadata names the bridge origin. It runs in two stages, because a block stops
new requests but not running ones, and the proxy writes their spend afterwards:

1. `--block` blocks every bridge key (`/key/block` with the hashed token).
2. Wait for running requests and the proxy's batched spend writes. 10 minutes is ample.
3. `--apply` reads each blocked key's final spend (`/key/info`) and grants
   `max_budget - spend`, rounded down to the musd, as a `starter_credits` credit. Then it
   deletes the organization's seeded vault connection ("Agenta", slug `starter-credits`)
   from each of its projects: its key is blocked, so an agent that picked it would only
   fail. Only the row the bridge manages is deleted; a user's own connection under the same
   slug stays. A key that is not blocked is counted as `not_blocked` and left alone.

A key whose organization is deleted or missing is granted nothing. A key spent to zero or
past its budget is granted nothing. A key with a missing or non-numeric budget or spend is
counted as `failed`, never guessed. A key the bridge itself blocked (its vault write failed)
still has its budget, and its organization receives it.

Run it once per deployment, against that deployment's own database and proxy, after the
wallet funds the models. Never run it against a shared deployment you do not own. From
`api/`, with the deployment's EE environment loaded (`AGENTA_LICENSE=ee`,
`POSTGRES_URI_CORE`, `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL`,
`AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY`, `AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID`):

```bash
# 0. Dry run (the default): counts keys and remaining budget, writes nothing.
uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet

# 1. Block every starter-credits key.
uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet --block

# 2. Wait 10 minutes, then grant the remainders. Safe to rerun.
uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet --apply
```

The last line prints the counts: `keys`, `skipped`, `no_organization`, `not_blocked`,
`blocked`, `zero_remaining`, `granted`, `granted_musd`, `remaining_musd`,
`connections_removed`, `failed`. A
non-zero `failed` gives a non-zero exit status; rerun to retry. Turn seeding off
(`AGENTA_STARTER_CREDITS_BRIDGE_ENABLED=false`) before stage 1, or a key minted after it is
not transferred.

The funded models replace the deleted connection: the model picker offers the gateway's
built-in models ("Built-in: agenta", [funded-models.md](funded-models.md)) to an
organization on the LLM gateway rollout. An agent whose saved model still names the deleted
connection is no longer runnable, so the picker selects another model, and a run that still
names it fails with a missing-connection error instead of a proxy refusal. Agent
configurations are not rewritten.
