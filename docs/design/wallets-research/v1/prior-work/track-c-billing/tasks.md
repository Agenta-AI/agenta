# Track C — tasks

Execution order for `feat/metering-track-c` (stacked on
`feat/metering-track-b`). Safety tag before re-partition:
`safety-track-c-pre-repartition`. Do C1 only after Track B's re-partition
commit exists.

## C1 — rebase + re-partition delta
- [ ] Commit or stash-inventory the current uncommitted work; rebase
      `feat/metering-track-c` onto the new `feat/metering-track-b` tip (or
      re-cut: cherry-pick/squash C-owned content onto B — pick whichever gives
      clean, reviewable commits; content end-state wins over history).
- [ ] Drop everything B now owns: enum members, quota entries,
      `ee0000000005`, `ee0000000004` edits, the seconds-block removal in
      `service.py`. After C1, `git diff feat/metering-track-b...HEAD` touches
      ONLY: `sandboxes/{debits,sink,gating}.py`, the one-line sink call in
      `sandboxes/service.py`, tests, and this track's docs.
- [ ] Rename `credits.py` → `debits.py`; `to_credits()` → `to_debits()`;
      `record_usage_credits()` → `record_usage_debits()`; update imports,
      docstrings, and comments (consumption side says debits; "credits" only
      for the funding ledger / millicredit unit).
- [ ] Verify sink writes per-dimension + `SANDBOX_DEBITS` + `WALLET_DEBITS`;
      gating reads `WALLET_DEBITS`; tests green; ruff clean. Commit.

## C2 — wallet schema
- [ ] `wallet_credits` DBE/DBA/DTO/DAO (columns per specs 2.1; mint `id` in the
      insert mapping; partial UNIQUE(organization_id, source_reference)).
- [ ] Migration for `wallet_credits` + the `credit_kind` enum.
- [ ] `subscriptions`: `tier` + auto-recharge columns, DTO/DAO extension,
      migration.
- [ ] `balance(organization)` query + Redis caching + invalidation on
      mint/debit. Unit tests: expiry predicate, negative balance, idempotent
      re-mint rejected.

## C3 — minting
- [ ] Config dials: signup-gift amount, per-plan allowance amounts (zero =
      no-op), thresholds `{25, 250, 2500}`.
- [ ] Signup hook: mint `signup_gift` for the signup organization only.
- [ ] Daily allowance cron (meters cron host): due+paid check, idempotent
      period-keyed mint, `expires_at` = period end.
- [ ] Webhook switch: add `checkout.session.completed`,
      `payment_intent.succeeded`, `payment_intent.payment_failed`; mandate the
      webhook secret in production.
- [ ] Top-up Checkout session creation endpoint.
- [ ] Admin endpoints for `admin_promotion` / `support_adjustment` with an
      audit log line.

## C4 — tier
- [ ] Recompute function (plain sum ≥ threshold, card-on-file above floor,
      `max(computed, manual)`), triggered on mint / subscription webhook / card
      events; writes `subscriptions.tier`; bumps entitlements cache.
- [ ] Tier→limits config table (concurrency / power / duration / ceiling per
      family; sandbox instantiated, others declared).

## C5 — gating + auto-recharge + true-up
- [ ] Gate reads wallet balance as the ceiling (preventive rule, per-family
      `f`, soft/`strict=False` launch default) — swap the source in
      `check_sandbox_quota`, keep the signature.
- [ ] Auto-recharge scheduled check → off-session PaymentIntent.
- [ ] True-up caller after debit writes: balance ≤ 0 → targeted kill invocation
      behind a flag (until the parameterized `/kill` lands mainline), else
      warn.
- [ ] Acceptance tests: mint→balance→gate→debit→true-up round trip; EE-only
      guards via `is_ee()`.
