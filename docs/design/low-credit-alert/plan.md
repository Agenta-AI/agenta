# Low-credit alert: plan

## Goal

Warn a user before the wallet refuses their next task, and give one click to the fix. Frontend
only (`web/mobile`, `web/packages`). No new endpoint. Out of scope: bugs found in research that do
not block this feature (for example the `hasCredits` composer gate reading a false 0 before the
first run of the UTC day).

## Facts this rests on

- `GET /wallets/summary` (every role, `VIEW_BILLING`) returns `spendable_musd` and every credit
  row with `credit_kind`, `amount_musd`, `remaining_musd`, `start_time`, `end_time`, `created_at`.
- A running turn always finishes. The wallet refuses the next turn at 0
  (`api/ee/src/core/wallets/admission.py:34-38`, `caps.py:181`).
- `daily_free` credits (75 a day, all public cloud plans) are minted on the first admission of the
  UTC day, expire at midnight UTC, at most 10 a month. The summary does not mint them, so it can
  read 0 before the first run while the next task would still start.
- Only `builtin`-namespace model calls spend credits for the model. Cloud sandbox runtime and
  managed tools spend credits whatever the model (`services/runner/src/server.ts:500-511`).

## Data shape

One pure function owns the decision. Callers render it; they do not branch on wallet fields.

```ts
type CreditAlert =
    | {kind: "none"}
    | {kind: "low"; remainingMusd: number}       // durable credits under the threshold
    | {kind: "daily"; todayMusd: number | null; refills: boolean} // only daily credits left
    | {kind: "empty"}                              // spendable 0 and no daily grant on the way

creditAlert(wallet: WalletSummary, now?: number): CreditAlert
```

- Durable credits = active credits that are not `daily_free`.
- `low`: durable total > 0 and durable remaining < max(100 credits, 20% of durable total).
- `daily`: durable remaining is 0 and either spendable > 0 or a daily grant is pending.
  `refills` = fewer than 10 `daily_free` rows this UTC month.
- Pending daily grant: the org has had a `daily_free` row before (its plan gets them), none for
  today (UTC), and fewer than 10 this UTC month.
- `empty`: spendable <= 0 and no pending grant.
- `mode !== "enforce"` gives `none`.

The fix the strip offers depends on what pays for the model:

```ts
type ModelFunding = "credits-with-own-key" | "credits-no-own-key" | "own-key"
```

- `own-key`: the agent's `agent.llm.connection.namespace` is not `builtin`.
- `credits-with-own-key`: the agent uses `builtin`, and the candidate list holds a non-`builtin`
  route (a stored key, custom provider, or subscription).
- `credits-no-own-key`: the agent uses `builtin` and no other route exists.

Copy and actions come from one table keyed by `(alert.kind, funding)`, not nested conditionals.

## UI

1. `CreditAlertStrip` above the composer, in the `ContentRail` with `ConnectModelStrip`. Same
   `RevealCollapse` motion and strip styling (warning tint for `low`, danger for `empty`, neutral
   for `daily`).
   - `low` + `credits-with-own-key`: "N credits left. Switch to your own model key to save
     credits." Main button "Switch model" opens the composer's `/model` picker. Secondary
     "Buy credits".
   - `low` + `credits-no-own-key`: "Add your own model key to save credits." Main "Add a key"
     opens `ProviderDrawer`. Secondary "Buy credits".
   - `low` + `own-key`: "N credits left for agent runtime and tools." Main "Buy credits".
   - `empty`: "Out of credits. New tasks will not start until you add credits." Main "Buy
     credits". Secondary is the funding fix where one exists. Not dismissible.
   - `daily`: "Running on today's free credits (N left). They reset at 00:00 UTC." (the reset
     clause only when `refills`). Secondary is the funding fix where one exists.
   - "Buy credits" shows only when billing is on and the user has `edit_billing`. It opens the
     existing `RunErrorBuyCreditsDialog` (its `onUpgrade` opens `RunErrorPlansDialog`, which covers
     Hobby). Members see no buy button.
   - Close (X) on `low` and `daily`: hidden for this browser session, in memory only (a jotai
     atom), no localStorage. It comes back when the alert kind changes.
2. `CreditsRemainingWidget`: bar and number turn amber for `low`, red for `empty`, with a small
   icon. Same `creditAlert` call. No new request.
3. Freshness: when a turn ends in the chat, invalidate `["wallet","summary"]` so the strip reads
   the new balance (the chat reads the summary with `poll: false`).

## Composer wiring

- `useChatSlashCommands` (packages/agenta-chat) returns `openModelPicker`, the same path `/model`
  uses (`openPicker("model")`).
- `Composer` takes `modelPickerRef?: MutableRefObject<(() => void) | null>` and fills it. The
  strip calls it. This matches the existing `inputRef` handle pattern.

## Files

- New in `web/mobile/src/features/wallet/`: `creditAlert.ts`, `modelFunding.ts`,
  `useModelFunding.ts`, `CreditAlertNotice.tsx` (presentational), `CreditAlertStrip.tsx`
  (data and actions).
- Tests: `web/mobile/tests/unit/creditAlert.test.ts`, `web/mobile/tests/unit/modelFunding.test.ts`.
- Story: `web/storybook/stories/developer-views/CreditAlertNotice.stories.tsx`.
- Changed: `wallet/CreditsRemainingWidget.tsx`, `chat/LiveConversation.tsx`, `chat/Composer.tsx`,
  `packages/agenta-chat/src/hooks/useChatSlashCommands.tsx`.

## Proof

- Unit test for `creditAlert`: low, daily with and without refill, pending grant (not empty), true
  empty, wallet off.
- Screenshots in the real app (`verify-agenta-mobile`): before (no strip, plain meter) and after
  for `low` with each funding case, `empty`, `daily`, and the `/model` picker opened from the
  strip. The local wallet balance is set by rewriting the `/wallets/summary` response in the page
  only; the PR says so.

## Self-review

- Removed a separate "pace" state: it needs `EDIT_BILLING` and the Credits tab already has it.
- Removed a phone hamburger dot: the composer strip already covers phones.
- Kept the funding table small: three funding cases times four alert kinds, with `none` rendering
  nothing.
- Risk: the `/model` picker lists every route, including built-in ones. The user picks the own-key
  row. Acceptable; the picker groups rows by connection name.
- Fixed (round 2): a config with no `namespace` (older saves, or no `connection` at all) counts as
  credit-funded when its slug matches a built-in endpoint slug or when it has no slug. Unknown
  funding warns rather than hides.
- Fixed (round 2): the strip hides while `ConnectModelStrip` shows (`modelBlocked`), so the
  composer never stacks two warnings.
- Risk: dismiss state lives in memory, so a reload shows the strip again. This is what was asked.
