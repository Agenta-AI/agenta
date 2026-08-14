# WP28 — tasks

Spec: [specs-wp28.md](specs-wp28.md). Design: `grants.md`, `journeys.md` §S4.

Parallel with `WP26`/`WP27`/`WP29` — nothing here depends on the Slack setup
packages, and none of them touch grants or the ingress acceptance suite. Merges
at M2, alongside `WP27` and `WP29`.

## Before writing anything

- [ ] Confirm locally that `resolve()` get-or-creates the space and evaluates grants
      by kind or id (`core/channels/service.py`, `core/channels/utils.py`) — this
      package adds no code there. If something looks missing, that is a defect to
      raise separately, not a reason to add a second implementation here.

## The drawer: three questions, not one list

- [ ] Split `GrantFormDrawer.tsx`'s single agent+space form into three sections per
      the agent's grant screen: Direct messages, Group chats, Which channels.
- [ ] Direct messages / Group chats are each a single allow/deny control writing
      `(agent, effect, kind=private)` / `(agent, effect, kind=group)`. No `space_id`
      field renders for these — the current form's `space_id` required-field rule
      is exactly what a kind-level grant cannot satisfy, so it cannot survive this
      change.
- [ ] Which channels stays a picker over `discover_spaces` candidates (already
      populated by `SpaceDiscoveryDrawer`'s existing call), each selection writing
      `(agent, ALLOW, space=<id>)`. Do not add a second discovery call — reuse
      `useChannelSpaceActions().discover`.
- [ ] Remove the hardcoded `effect: "allow"` in the create path. `effect` becomes a
      real field the three questions each set explicitly.

## Denials

- [ ] Add the effect control (`ALLOW` / `DENY`) — the thing the old code's comment
      said needed its own control before a denial could be authored.
- [ ] Support a per-channel deny row from the "which channels" picker, so
      `(ALLOW, kind=topic)` + `(DENY, space=#secrets)` is expressible in one screen.
- [ ] State the accepted cost next to the effect control when a DENY targets a
      `kind`: a narrower ALLOW on one space inside that kind will not re-admit it.
      Say what to do instead (unstate the broad deny, allow topics individually) —
      do not let this surface only as a support question.
- [ ] Do not build any precedence/reordering UI. Deny always wins; there is nothing
      to reorder, and a drag-to-reorder control would say the opposite.

## Default-deny stays visible

- [ ] The agent detail screen's grant section reads as three answered/unanswered
      questions (DMs, group chats, N channels), not a bare table of `space_id`
      values — a reader must be able to tell "not yet answered" from "answered no"
      from "answered yes" at a glance.
- [ ] An unanswered question shows as refused, not blank — `D17`'s point is that a
      silent refusal has no diagnostic anywhere else, so this screen is where the
      diagnostic has to live.

## The `not_in_channel` warning

- [ ] On a channel row that has a grant but no confirmed Slack invite, show a
      warning naming `/invite @Agenta` and the `not_in_channel` failure it prevents.
      This is a UI-only signal — nothing in the backend tracks "invited," so surface
      it as "granted, not yet confirmed" rather than claiming certainty the API
      cannot back.

## The acceptance test

- [ ] New test file (or a new test in the existing seam file — match whichever
      keeps the fixture reuse cleanest) in
      `api/oss/tests/pytest/integration/channels/`, marked `pytest.mark.integration`
      — **not** `acceptance/`. It needs Postgres only (the `channels_scope` fixture
      already used by `test_channels_ingress_slack_seam.py`), no live Slack
      credentials, so the repo's own tiering rule (one runtime dependency =
      integration) puts it here even though the design prose calls this "the
      acceptance test."
- [ ] Build a Slack event body with `channel_type: "im"` (or the `event.channel_type`
      shape `classify_space_kind`'s existing unit tests already cover) — a real
      is_im-shaped payload, not a channel message.
- [ ] Sign it the same way the existing fixture signs a channel message
      (`_signed_headers` / the `v0:` HMAC scheme) and POST to
      `/channels/slack/events/` against the seam's real `ChannelsService` +
      `ChannelsDAO`.
- [ ] Seed exactly one grant row ahead of the request: `(agent, ALLOW,
      kind=private)`. Seed no space row — the space must not exist before the
      request, or the test proves nothing F51's unit test didn't already prove.
- [ ] Assert the request is accepted (202, one inbox row — same shape the existing
      seam tests assert).
- [ ] Assert the space that gets created on first contact carries `kind=PRIVATE`.
- [ ] Assert resolution returns the agent the kind-level grant names — this is the
      "ends in an answer" the test is for. Do not extend the assertion into
      rendering a reply or the outbox worker; that is covered elsewhere and adding
      it here would blur what this test is proving.

## Tests

- [ ] Frontend: package unit tests per `web/AGENTS.md` conventions, co-located
      `*.test.ts` files extracting pure functions the way `PolicyEditor.test.ts`
      already does (e.g. the effect-control state machine, the deny-cost copy
      selection) — needs nothing running.
- [ ] Backend: the integration test above needs Postgres — classify it as
      integration, not unit, and do not claim it passes without a Postgres
      connection available.
- [ ] `pnpm lint-fix` in `web/` before committing.

## Done when

- [ ] All four sentences from `grants.md` are producible from the UI: kind-level
      allow, kind-level deny, space-level allow, space-level deny.
- [ ] No form on this screen requires `space_id` for a kind-level grant.
- [ ] The agent detail screen shows current DM/group-chat/channel allowances at a
      glance, including "not yet answered."
- [ ] A granted-but-not-invited channel shows the `not_in_channel` warning.
- [ ] The integration test passes against real Postgres: unseen DM space, seeded
      kind-level ALLOW, real signed HTTP request, agent resolved.

## Watch for

- **Do not touch `resolve()`, `evaluate_grant_effect`, or the DAO's grant matching.**
  They are done and verified; this package's job is entirely the surface above
  them and the one test that drives them through the real wire.
- **Do not add a route.** Every field these forms need is already on
  `ChannelGrantCreate`/`ChannelGrantEdit`/`ChannelGrantQuery`.
- **Do not file the acceptance test under `acceptance/`.** It has no live-credential
  gate, so it belongs in `integration/` regardless of what the design prose calls it.
