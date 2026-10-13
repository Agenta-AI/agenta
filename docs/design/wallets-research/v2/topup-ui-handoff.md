# Credit top-ups in the app: handoff for UI and UX work

This guide is for the person who continues the UI and UX of buying credit packs. It says
what the flow does today, which files hold it, how to run it on a local stack, how to test
it, and which UX questions are still open.

## What the flow does

An organization on a paid plan (Pro or Business) can buy a one-time credit pack. There are
three packs: 1,000 credits for $10, 2,500 credits for $25, and 10,000 credits for $100.
Purchased credits expire 365 days after the payment. The packs and prices live in the API
(`api/ee/src/core/wallets/purchases.py`), and the app reads them from the API. The app never
hardcodes a price.

1. The person opens the pack picker and selects a pack.
2. The app asks the API for a Stripe Checkout session and moves the tab to Stripe.
3. The person pays on Stripe, or goes back.
4. Stripe sends the person back to the page they left:
   - after a payment, the page says "Payment received" and asks the API whether this
     Checkout session has been credited, every 3 seconds, then says "Credits added". After
     2 minutes without the credit, it says the credits have not appeared yet and offers
     "Check again";
   - after "Back", the page says "Checkout cancelled. You were not charged."
5. Separately, Stripe sends the `checkout.session.completed` webhook to the API, which
   grants the `purchase` credit (idempotent per Checkout session).

The free plan (Hobby) cannot buy packs. Where a paid plan sees "Buy credits", Hobby sees
"Credit packs are available on paid plans." and an "Upgrade" button.

Everything new appears only for an organization whose wallet mode is `enforce`. Where the
wallet is off or in shadow (or Stripe is not configured), the app shows exactly what it showed
before: no section, no chat button, no return notice, and no error state. The checkout endpoint
refuses those organizations. The rule lives in one place, the API's `status` (`available` or
`paid_plan_required` are only answered for an enforced organization); the UI reads it.

Each top-up creates a paid Stripe invoice (Checkout `invoice_creation`), so the customer gets
an invoice and a receipt, and the purchase is listed in the billing portal. The invoice's own
webhook events belong to no subscription, so the API acknowledges and skips them; the credit
still comes from `checkout.session.completed`, once per session.

### Where the entry points are

| App | Place | What it shows |
| --- | --- | --- |
| `/m` (`web/mobile`) | Settings, Credits tab, below "Credits remaining" | "Buy credits" (paid) or "Upgrade" (Hobby) |
| `/m` | Settings, Usage & Billing, at the bottom | "Buy credits" (paid) or "Upgrade" (Hobby) |
| `/m` | Chat, the "You're out of credits" callout | "Buy credits" next to "Plans and billing" (paid plans only) |
| `/w` (`web/oss` + `web/ee`) | Settings, Usage & Billing, at the bottom | "Buy credits" (paid) or "Upgrade" (Hobby) |
| `/w` | Chat, the out-of-credit callout | "Buy credits" next to "Plans and billing" (paid plans only); "Plans and billing" for every plan limit (new in `/w`) |

The chat button opens the settings page with the picker already open: `/m` goes to
`?tab=credits&buy_credits=1`, `/w` goes to `?tab=billing&buy_credits=1`. The chat callout
offers "Buy credits" only for the error code `wallet_balance_exhausted`. The sidebar credits
meter has no buy entry yet (see the open questions).

## Files

API (EE):

- `api/ee/src/apis/fastapi/billing/router.py`: `GET /billing/stripe/topups/packs` (the packs
  and a `status`), `POST /billing/stripe/topups/` (creates the Checkout session; takes
  `pack`, `success_url`, optional `cancel_url`). Both answer from `_top_up_status`, so the
  app never offers a purchase that the checkout refuses. `GET /billing/stripe/topups/{checkout_session_id}`
  says whether that session's payment has been credited (the return screen uses it). The
  webhook grant is `_grant_top_up`.
- `api/ee/src/apis/fastapi/billing/models.py`: the response models.
- `api/ee/src/core/wallets/purchases.py`: the packs (source of truth for prices).
- `api/ee/src/core/wallets/caps.py`: the out-of-credit sentence (approved wording; do not
  change it from the UI side).

`status` values: `available`, `paid_plan_required` (free plan, or no Stripe subscription),
`unavailable` (wallet off or not `enforce` for the organization, or Stripe or its webhook
secret not configured).

Shared UI (used by both apps, no antd), `web/packages/agenta-settings-ui/src/billing/topups/`:

- `CreditTopUpsSection.tsx`: the section a page mounts. It decides what to show from the API
  `status`, opens the picker, and shows the return notice. Props: `projectId`, `topUpReturn`,
  `openPicker`, `onQueryHandled`, `onUpgrade`, `framed`.
- `BuyCreditsDialog.tsx`: the pack picker and the checkout call, with its error states.
- `TopUpPackOption.tsx`: one pack row.
- `TopUpReturnNotice.tsx`: picks the notice for the return (cancelled, or a paid checkout).
- `TopUpPaymentNotice.tsx`: one paid checkout: waiting, credits added, still waiting.
- `topUpRules.ts`: the pure rules (what to offer, return URLs, reading the return, error
  mapping, price format). Change behaviour here first.
- `useTopUpOffer.ts`, `useTopUpLanding.ts` (the polling and the timeout), `api.ts`: data.

The return URLs: Stripe sends a paid checkout back with `topup=success&topup_session=<id>`
(Stripe fills in the session ID) and a cancelled one with `topup=cancelled`. The page reads
them, keeps the notice in state, and removes them from the URL.

Chat callout:

- `web/packages/agenta-chat/src/components/RunFailureCallout.tsx`: `BUY_CREDITS_CODES` and
  the `onBuyCredits` prop (the `/w` callout).
- `web/mobile/src/features/chat/RunErrorCallout.tsx`, `TurnRow.tsx`, `providerRecovery.ts`
  (`useBuyCreditsRoute`): the `/m` callout.
- `web/oss/src/components/AgentChatSlice/components/AgentRunFailure.tsx` and
  `hooks/useBillingEscapes.ts`: the `/w` callout wiring.

App bindings (thin; they only pass URL state and the upgrade path):

- `web/mobile/src/features/wallet/CreditTopUps.tsx`, mounted in `CreditsTab.tsx` and in
  `web/mobile/src/features/settings/BillingTab.tsx`.
- `web/ee/src/components/pages/settings/Billing/index.tsx` (the `/w` billing page).

## Run it locally

You need the EE dev stack and Stripe test keys. Use test keys only (`sk_test_...`).

1. In your EE env file (for example `hosting/docker-compose/ee/.env.ee.dev`), set:
   - `AGENTA_WALLETS_ENABLED=true`
   - leave `AGENTA_ROLLOUT_FLAGS_ENABLED` unset. With it unset, every organization reads as
     `enforce`, so the Credits tab and the packs appear.
   - `STRIPE_API_KEY=<your Stripe test secret key>`
   - `STRIPE_WEBHOOK_SECRET=<the signing secret of your stripe listen session>`
   - `STRIPE_PRICING=...` with your test price IDs for Pro and Business (needed only to buy a
     plan; packs need no Stripe products, they use inline prices).
   - `NEXT_PUBLIC_AGENTA_BILLING_ENABLED=true` and `NEXT_PUBLIC_AGENTA_WALLETS_ENABLED=true`
     for the web apps.
2. Start the stack: `load-env hosting/docker-compose/ee/.env.ee.dev` then
   `bash ./hosting/docker-compose/run.sh --ee --dev --build`.
3. Webhook forwarding. The compose file has a `stripe` service that runs
   `stripe listen --forward-to http://api:8000/billing/stripe/events/` with the events the
   API needs, including `checkout.session.completed`. It uses `STRIPE_API_KEY`. To get the
   signing secret for `STRIPE_WEBHOOK_SECRET`, run `stripe listen --print-secret` with the
   same key, put the value in the env file, and recreate `api`. If a top-up is paid but no
   credit appears, check the listener first:
   `docker logs <stack>-stripe-1 | grep checkout.session.completed` must show `[200]`. An
   old listener container may lack that event; recreate it.
4. Make an organization Pro. Sign up in the app (the new organization is on Hobby), then go
   to Usage & Billing, choose "Upgrade plan", pick Pro, and pay on Stripe Checkout with a test
   card. The `customer.subscription.created` webhook makes the organization Pro.
   The admin route `POST /admin/billing/plans/switch?organization_id=...&plan=...` (with
   `Authorization: Access <AGENTA_AUTH_KEY>`) switches between paid plans of an organization
   that already has a Stripe subscription; it does not create one.
5. Get to zero credits to see the chat callout. Either spend them, or set the organization's
   rows in `wallet_balances` to 0 in Postgres (save the old values first, and put them back
   after). Then send a message to an agent that uses an included model. The callout
   "You're out of credits" appears with "Buy credits" (paid plan) next to
   "Plans and billing".

### Test cards

- `4242 4242 4242 4242`, any future date, any CVC: the payment succeeds.
- `4000 0000 0000 0002`: the card is declined (Stripe shows the error; the app is not
  involved).
- `4000 0025 0000 3155`: asks for 3D Secure authentication.

Stripe adds tax when the billing address is in a taxed country (automatic tax is on). The
webhook checks the subtotal against the pack price, so tax does not block the grant.

Step-by-step screenshots of every flow in both apps (purchase from each entry, out of credits,
cancel, Hobby, error states, the Stripe invoice) are in the PR's evidence; ask Mahmoud for the
`flows/` folder and its `index.md`.

## Test it

Unit tests:

- API: `cd api && AGENTA_LICENSE=ee uv run pytest ee/tests/pytest/unit/test_billing_credit_sources.py`
  (pack list, the three statuses, checkout gating, cancel URL).
- Shared UI: `cd web/packages/agenta-settings-ui && pnpm test` (`topUpRules.test.ts`,
  `creditTopUpsSection.test.tsx`).
- Chat callout: `cd web/packages/agenta-chat && pnpm test`
  (`runFailureCallout.test.tsx`).
- `/m`: `cd web/mobile && pnpm test` (`runFailureCallout.render.test.tsx` covers the chat
  button and where it goes).
- `/w`: `cd web/oss && npx vitest run src/components/AgentChatSlice/components/AgentRunFailure.test.tsx`.

Live journey (both apps):

1. Pro organization, Credits tab (`/m`) or Usage & Billing (`/w`): "Buy credits" shows.
2. Open the picker, choose a pack, "Continue to checkout", pay with 4242. Back on the page:
   "Credits added", and the new "Purchased credits" row appears in the credits list.
3. Repeat and press "Back" on Stripe: "Checkout cancelled. You were not charged."
4. Switch the organization to Hobby: the section shows "Upgrade" instead.
5. At zero credits, send a chat message: the callout shows "Buy credits", which opens the
   picker on the settings page.

The `/w` app redirects to `/m` by default. Add `?view=desktop` once to a `/w` URL to stay
on `/w`.

## Open UX questions

1. Pack layout. Today it is a dialog with three radio rows (credits on the left, price on
   the right) and one "Continue to checkout" button. Options: three cards with one button
   each, a "most popular" mark, the price per 100 credits. There is no volume bonus
   (product decision), so all packs cost the same per credit.
2. Where the entry points live. `/m` has the entry on the Credits tab and on Usage &
   Billing; `/w` has it on Usage & Billing (it has no Credits tab). Should the sidebar credits
   meter link to the picker?
3. Low-balance nudge. Nothing prompts a purchase before the balance reaches zero. A nudge
   could live in the sidebar meter, the Credits tab, or the chat. It needs a threshold
   decision (for example a share of the monthly allowance).
4. Past purchases. Each top-up now has a paid Stripe invoice (in the billing portal and by
   email). The app itself lists purchased lots on the Credits tab but no purchase history with
   links to invoices. Is the portal enough?
5. Copy review. Every new string is listed in the PR description. None of them are
   approved yet. The API sentences in `caps.py` are approved and stay as they are.
6. Waiting state. The return screen waits 2 minutes, then offers "Check again". Is that
   right, and should the timed-out state also link to support?
7. Who may buy. Buying needs the billing edit permission; others see an error in the
   picker. Should the button be hidden for them instead?
