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
- A failed plan read or grant is logged and never fails the admission. The admission reads
  the balance without the grant, and the next admission retries.
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
- The period is the latest-starting invoice line's period. A renewal also carries usage lines
  billed in arrears for the period that just ended.
- The first period takes the plan from the invoice's subscription metadata. Stripe does not
  order `customer.subscription.created` before the first invoice, so the local subscription
  may still be on the free plan. A renewal takes the local plan: a plan switch updates the
  local plan but not the Stripe metadata.
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
starter-credits program team's keys on the proxy (`/key/list` with full objects), keeps the
keys whose metadata names the bridge origin, and for each one:

1. Blocks the key (`/key/block` with the hashed token), unless it is already blocked.
2. Reads the key's final spend (`/key/info`).
3. Grants `max_budget - spend`, rounded down to the musd, as a `starter_credits` credit.

Block first, then read: a key spending between the read and the block would be paid twice.
A key whose organization is deleted or missing is blocked and granted nothing. A key spent
to zero or past its budget is blocked and granted nothing. A key the bridge itself blocked
(its vault write failed) still has its budget, and its organization receives it.

Run it once per deployment, against that deployment's own database and proxy, after the
wallet funds the models. Never run it against a shared deployment you do not own. From
`api/`, with the deployment's EE environment loaded (`AGENTA_LICENSE=ee`,
`POSTGRES_URI_CORE`, `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL`,
`AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY`, `AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID`):

```bash
# 1. Dry run (the default): counts keys and remaining budget, writes nothing.
uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet

# 2. Block the keys and grant the credit. Safe to rerun.
uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet --apply
```

The last line prints the counts: `keys`, `skipped`, `no_organization`, `zero_remaining`,
`granted`, `granted_musd`, `remaining_musd`, `blocked`, `failed`. A non-zero `failed` gives a
non-zero exit status; rerun to retry. Turn seeding off
(`AGENTA_STARTER_CREDITS_BRIDGE_ENABLED=false`) before the run, or a key minted after it is
not transferred.

Left for the funded-models step: the seeded vault connection ("Agenta") stays in each
project after its key is blocked, and calls through it then fail.
