# WP28 — Where it answers

The configuration surface for grants, and the thing that makes direct messages work.
`waves.md` calls it WP-S3.

Design: `grants.md`, `journeys.md` §S4.

## The mechanism already landed. This package does not touch it.

Say this plainly because a spec that implies otherwise sends someone to rebuild a
mechanism that is already built and verified. Wave 5 shipped it, and `F51`'s review
entry is closed against the code, not the ledger:

- spaces are created on first contact (`get_or_create_space`) and authorise nothing
- `channel_grants.kind` and `.space_id` are both nullable, exactly one required at
  write time (`_validate_grant_rule`)
- matching reads `or_(space_id, kind)`
- `evaluate_grant_effect` is deny-first
- `test_kind_allow_admits_a_never_seen_space` asserts the whole scenario: an unseen
  DM space, no operator pre-approval, a kind-level ALLOW, an agent resolved

So WP28 writes **no new domain mechanism.** It is a UI surface plus an acceptance
test. The API routes it needs already exist on `channels/router.py`
(`POST /grants/`, `PUT /grants/{id}`, `POST /grants/query`,
`POST /grants/{id}/default`) and accept `kind` and `effect` today — this package
writes against them, it does not add to them.

## What is actually broken today

`GrantFormDrawer.tsx` requires both `agent_id` and `space_id` as required form
fields, and hardcodes `effect: "allow"` with a comment saying a denial needs its own
control before it can be authored. Both are exactly backwards for what `grants.md`
prescribes:

- a kind-level grant has no `space_id` — the field being required makes the one
  case this package exists for impossible to submit
- a denial is not an edge case reached later — it is how "any channel except
  `#secrets`" gets said at all

This package fixes both, in the shape `journeys.md` §S4 specifies.

## Three questions, not one list

| | typical answer | written as |
| --- | --- | --- |
| Direct messages? | yes | `(agent, ALLOW, kind=private)` |
| Group chats? | usually no | — |
| Which channels? | a few, picked from a list | `(agent, ALLOW, space=#ops)` … |

**Why three questions and not one list.** A list works when every option can be
enumerated in advance. Topics can — they are few, named, and exist before anyone
asks. DMs and group chats cannot: a DM exists because someone opened it, one per
user, unbounded; a group chat is an ad-hoc set of people. `grants.md`'s table on
this is the reason the old space-row-per-permission design silently refused every
Slack DM — the row could never have existed to be pre-approved.

`discover_spaces` keeps its job. It still calls `conversations.list` and still fills
the channel picker for the third question. It never had to enumerate the other two
kinds, and it never could — nothing changes there, which is the point: the fix is
in what asks for a *kind*, not in what discovers spaces.

## Denials are authorable

`(ALLOW, kind=topic)` plus `(DENY, space=#secrets)` is "any channel except that
one" — the exclusion a single list of approved spaces could never express, because
there is no row type in that shape for "not this one."

**Deny wins regardless of specificity.** The UI must not imply the opposite —
no "more specific rule wins" framing, no drag-to-reorder that would suggest
precedence is orderable. A DENY row beats an ALLOW row it is narrower than, on
purpose (`D25`: "a stated `false` wins").

**State the accepted cost where the user can see it.** You cannot re-allow one
space inside a denied kind: `(DENY, kind=topic)` plus `(ALLOW, space=#ops)` still
refuses `#ops`. The fix is to unstate the broad denial and allow the topics
individually — a configuration change, not a bug to file. The drawer should say
this near the effect control, not leave it to be discovered as a support ticket.

## Default-deny stays visible

An unanswered question means no allow rule, which means refused — unchanged. The
danger is that this refusal has no diagnostic anywhere else (`D17`): it looks
identical to a denied rule and identical to "no such agent." So the surface itself
is the only place a reader can see *what is currently allowed*. The agent detail
screen's grant list (already present, currently space-only) is where this lives;
it needs to read as three answered-or-not questions, not a bare table of rows.

## The `not_in_channel` warning

A grant says the agent *may* answer somewhere. Slack's `/invite @Agenta` in that
channel is what makes it *able* to. Both are required, and today only one is
visible in the product — a channel granted but never invited fails at call time
with `not_in_channel`, an error every comparable product's docs mention because
everyone hits it. Name it in the UI before it happens: next to the channel picker
or on a channel row that has a grant but no confirmed invite, not after the first
failed call.

## The acceptance test — the package's real deliverable

Everything above is surface. This is substance, and it is what `F51`'s closure note
left unfinished: *"no test drives a DM through the HTTP ingress as a real Slack
`is_im` payload."* `test_kind_allow_admits_a_never_seen_space` proves the service
function in isolation, with fakes standing in for the DAO and the adapter. Nothing
proves the seam: the real signature-checked HTTP route, a real Postgres row, a real
kind-level grant, resolving to a real agent.

**What it drives:** a Slack event body shaped like a DM (`channel_type: "im"`, the
shape `classify_space_kind` already unit-tests) — signed the same way
`test_channels_ingress_slack_seam.py`'s existing fixture signs a channel message —
POSTed to `/channels/slack/events/`, against a real `ChannelsService` and a real
`ChannelsDAO` over Postgres, with one grant row seeded ahead of the request:
`(agent, ALLOW, kind=private)`. No space row exists before the request. The
assertion chain: the event is accepted (202, one inbox row — the existing seam
tests already prove this shape); the space gets created on first contact with
`kind=PRIVATE`; the grant matches by kind, not by id; the agent that comes back
from resolution is the one the grant names. That last step — an agent actually
resolved, not just a row written — is the "ends in an answer" this test is named
for; what happens after resolution (rendering a reply, the outbox worker) is
already covered elsewhere and is out of scope here.

**Classify it correctly, and note where this spec's own language misleads.** This
document and `wave6.md` call it "the acceptance test," and the file-ownership table
names "the routing acceptance suite." Read literally against this repo's test
tiers, that is the wrong word: the test needs exactly one runtime dependency
(Postgres, via the `channels_scope` fixture already used by
`test_channels_ingress_slack_seam.py`), not a live Slack workspace or a live
deployment — so by the repo's own rule it is an **integration** test, and it
belongs in `api/oss/tests/pytest/integration/channels/`, marked
`pytest.mark.integration`, next to the seam test it extends. The `acceptance/`
directory in this repo is reserved for tests gated on live external credentials
(`test_slack_adapter_live.py` needs `SLACK_BOT_TOKEN`; this test needs none). Build
it there. "Acceptance" in the design prose means *this is the criterion the package
is accepted against*, not *this is a pytest acceptance-tier test* — do not let the
word choice put the file in the wrong directory.

## Files it owns

- `web/oss/src/components/pages/settings/Channels/components/Grant*` — the drawer,
  split into the three-question shape
- `web/oss/src/components/pages/settings/Channels/components/PolicyEditor.tsx` —
  touched only if the effect control needs to live beside it; the policy fields
  themselves are unrelated to this package's change
- `api/oss/tests/pytest/integration/channels/` — the new DM-through-ingress test,
  added beside `test_channels_ingress_slack_seam.py`

No API route, DTO, service method, or DAO method is added or changed. Every field
this package's forms write already exists on `ChannelGrantCreate`.

## Constraints

- Do not invent routes. `create_channel_grant`, `edit_channel_grant`,
  `query_channel_grants`, `set_channel_grant_default` are what exist; the three
  questions and the deny control all write through `create` with different
  `kind`/`space_id`/`effect` combinations.
- Never cite a design-process filename inside code or a test name. Test names
  describe the scenario (`test_kind_allow_admits_a_never_seen_space`), not the
  document that specified it.
- `pnpm lint-fix` in `web/` before committing any frontend change.

## Done when

- A grant drawer can produce all four sentences from `grants.md`: kind-level
  allow, kind-level deny, space-level allow, space-level deny — without ever
  requiring a `space_id` for a kind-level rule.
- The agent detail screen shows, at a glance, whether DMs and group chats are
  currently allowed, and which channels are granted.
- A channel with a grant but no recorded invite shows the `not_in_channel` warning.
- The integration test above passes against real Postgres: an unseen DM space, a
  kind-level ALLOW seeded ahead of time, an agent resolved through the real HTTP
  ingress.

## Out of scope

- Anything Slack-specific to installation or OAuth (`WP26`, `WP27`).
- The bridge and its two-bridge comparison (`WP29`).
- A live Slack workspace proving the invite/`not_in_channel` behavior for real —
  that is `CU-C`'s deployment, not this package's test.
- Sharper denials (per-thread, time-boxed) — `grants.md` leaves this open and
  nothing in this wave asks for it.
