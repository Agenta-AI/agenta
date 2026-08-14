# Wave 6 → C6

Runs from C5 to C6 as one cycle:

```text
CU-A  →  packages ⇄ merges  →  final merge  →  CU-B  →  deploy  →  CU-C  →  C6
```

**Exit condition:** an operator sets up Slack from the manifest, pastes the values,
and gets an answer to a **direct message**. Separately, a second operator installs
the Agenta Slack app in one click and reaches the same result. The bridged path
agrees with the in-process one.

That is the first wave where a real platform credential travels the whole path. C5
proved the loop with no credentials at all; everything Slack-specific is this wave's.

**Why the DM is the exit condition and not a channel message.** A channel message
was reachable before this project started. The DM was the case the permission
mechanism could not express, and it is the case an operator hits first — the fastest
way to try a bot is to message it. The mechanism landed in wave 5; nothing writes
the rule it needs and no test drives a real DM payload through the ingress.

**What C6 does not claim.** No non-Slack platform has been set up. The wire contract
is not published — `plan.md` ties publishing to a non-Slack channel shipping on it,
so Telegram gates that regardless of what C6 demonstrates.

## What changed before the wave started

Two things, and both change the plan rather than the code.

**`F51` is fixed, and the wave is smaller for it.** *"Every DM is silently
refused"* was still marked open going into planning. Verified against the code
instead of the ledger: spaces are created on first contact, grants carry `effect`
and match by `kind` or `space_id`, evaluation is deny-first, and the whole scenario
is asserted by a unit test. So WP28 is a configuration surface plus one test that
drives a real direct message through the ingress — not a mechanism.

**The hosted app is designed.** It was wave 5's design deliverable for this wave and
had not been done, which would have started WP27 blocked. `hosted-app.md` now
carries it, and it found one thing §0 could not see: the signing secret is per
*app*, so a hosted connection stores a bot token and nothing else, and the adapter
resolves its verification secret from two places. That is a code consequence, not a
copy change.

## CU-A — before any package

Ledger: [tasks-cu-wave6.md](tasks-cu-wave6.md).

Three kinds of debt.

**The ledger was stale, and packages get planned from it.** F51 read open and was
fixed. Five more P1s — the button parser, the stream round trip, the global
connection key, the connection-data write path, the credential schema — named work
wave 5's packages existed to do, and nothing in the file said whether they closed.

**Five of six are now closed, each verified against the code rather than a commit
message.** The sixth is genuinely half true and needs splitting: the credential
declaration exists and Slack fills it, and no human can reach the route that uses it.

Of 21 open findings going into this wave, six were about work already finished. That
is why this item is CU-A's first and not its last — planning off a ledger wrong by
six entries is how a wave sizes itself wrongly, which it just nearly did.

**The guards that lie.** Wave 5's own list, plus the Slack-specific one `waves.md`
names: the contract suite builds adapters the way tests find convenient rather than
the way the composition root builds them. That is the defect shape this project has
now found six times, and this is the wave where the adapter under test finally has
real credentials behind it.

**One payload nobody has ever seen.** `F53` — the enterprise-install shape was
reconstructed from documentation. Its failure mode is a bare 401, indistinguishable
from a bad secret. The hosted app puts every customer on one `api_app_id`, so the
org-wide and per-workspace installs coexisting stops being exotic. Capture one real
payload of each kind before the packages depend on the guess.

## Packages

| Spec | Tasks | Package | Depends on |
| --- | --- | --- | --- |
| [specs-wp26.md](specs-wp26.md) | [tasks-wp26.md](tasks-wp26.md) | Slack setup, customer-owned | — |
| [specs-wp27.md](specs-wp27.md) | [tasks-wp27.md](tasks-wp27.md) | Slack setup, the hosted app | WP26 |
| [specs-wp28.md](specs-wp28.md) | [tasks-wp28.md](tasks-wp28.md) | Where it answers | — |
| [specs-wp29.md](specs-wp29.md) | [tasks-wp29.md](tasks-wp29.md) | The bridge, re-verified | WP26 |

`waves.md` names these WP-S1 to WP-S4 in the same order.

**WP29's name is only half accurate, and the half that is wrong is the bigger half.**
The two-bridge test exists, `F45` is closed, and per-connection capabilities really
did fix it — that half is a check, and it holds. The in-process-versus-bridged
comparison is **not** a re-verification: it does not exist anywhere in the tree.
`plan.md` calls it WP11 and WP17 shipped without it. So budget it as new work.

It also picks up `F63`: the bridge adapter reads `delivery_url` to know where to post
a reply, and nothing in the source writes it. Only an acceptance fixture does, by
inserting the row directly. A bridge created the supported way accepts events, runs
the agent, and cannot deliver one answer. That is the third read-with-no-writer on
this one adapter, and all three survived the same way — the fixtures seed rows
directly, so the suite proves the adapter and never the path.

### Merge points

```text
WP26 ──M1── ┬─ WP27 ─┐
            └─ WP29 ─┤
WP28 ───────────────-┴──M2 ── CU-B → deploy → CU-C
```

| | merges | then |
| --- | --- | --- |
| **M1** | WP26 — the setup routes and the create form | WP27 and WP29 branch from it |
| **M2** | WP27, WP28, WP29 | **the final merge** — CU-B, deploy, CU-C |

**Why WP26 is first and alone.** It adds the per-channel setup route (`F62`) and the
first connection-create form in web. WP27 extends both — the same page grows a second
button, the same route family grows an install and a callback — and WP29 fills the
per-connection document slot beside it. Building either against an unmerged WP26
means two moving foundations under one form, which is what serialising the top of
wave 5 avoided.

**Why WP28 is parallel.** Its mechanism already exists. It writes grant rows through
routes that shipped, and its own test drives a real direct-message payload through
the ingress. It touches the grant components and the routing tests, and neither of
the Slack packages goes near them.

**One word in this document to read carefully.** *Acceptance* here means *the
criterion a package is accepted against*, not the pytest tier of the same name. This
repo reserves the `acceptance/` directory for tests gated on live external
credentials. WP28's headline test needs Postgres and nothing else, so it is an
**integration** test and belongs beside the ingress seam tests. `specs-wp28.md` says
so at the point it matters; noted here because the word appears in every wave
document and has misfiled a test before.

**WP26 is the bottleneck.** If it slips, WP27 and WP29 slip with it and only WP28
carries on.

### At an intermediate merge

Rebase and carry on. No deployment, no acceptance run, no CU phase. What is worth
doing at M1, because it is cheap and the alternative is finding it at M2: the branch
builds, its own suite passes on the merged base, and the reachability check for
**that package's** new symbols only.

The full check is CU-B's.

## File ownership

| WP | Owns |
| --- | --- |
| WP26 | the per-channel setup route, `core/channels/service.py` (setup), `web/…/settings/Channels/` connection create |
| WP27 | `core/channels/adapters/slack/oauth.py` and the install/callback routes, `utils/env.py`, the app-model half of the per-connection declaration |
| WP28 | `web/…/settings/Channels/components/Grant*`, `PolicyEditor`, the routing integration tests |
| WP29 | `core/channels/adapters/bridge/`, the per-connection setup document, the two-bridge comparison |

### Collisions

| File | Who | Handling |
| --- | --- | --- |
| `apis/fastapi/channels/router.py` | WP26, WP27, WP29 | **Serialised by the merge points.** WP26 lands its route first; WP27 and WP29 add theirs on the merged file, never in parallel with it. |
| `core/channels/adapters/slack/adapter.py` | WP26, WP27 | WP26 does not touch it — `verify_connection` and the setup document already exist. WP27 alone adds the two-source verification secret. Stated because it looks shared and is not. |
| `core/channels/dtos.py` (`ChannelSetup`) | WP26, WP29 | WP26 adds nothing to the type; WP29 fills the `document` slot the type already has. No schema change from either — checked, and it is why `D37` is cheap. |
| `web/…/settings/Channels/Channels.tsx` | WP26, WP27, WP28 | Each adds its own section or drawer. Land WP26 first; the other two rebase. The page is a list of sections, so additions do not overlap. |
| `utils/env.py` | WP27 alone | Three settings for the hosted app, consumed through the shared `env` object, never `os.getenv`. |

## CU-B — after the final merge, before deploy

The reachability check, as always: every symbol any package introduced, grepped for
callers outside its own module. Specifically for this wave, because each has failed
once already in some form:

- the per-channel setup route reached by the web page, not only by a test
- the hosted install route absent — refusing, not 500ing — when the deployment sets
  no client credentials
- the two-source verification secret exercised by both a customer-owned and a hosted
  connection, because a branch taken one way only is a branch nobody tested
- a kind-level grant written by the form and read by `resolve`, end to end
- the bridge's generated document reaching the create response, since a secret shown
  nowhere is a secret nobody can use

## Deploy

A checkpoint activity, and not the agent's to run. It needs a publicly reachable
request URL — Slack cannot call a laptop. The tunnel is part of the deployment, and
the setup page has to say so, because otherwise the failure arrives as no event ever
appearing, which is the hardest kind to diagnose.

### Before bringing it up

Three settings, and two of them get registered with a provider, so changing them
afterwards means editing an app somebody else owns.

**A reserved tunnel domain.** `NGROK_DOMAIN_INGRESS`. The provider stores both the
request URL and the redirect URL, so an address that rotates on restart invalidates
both. This is the whole reason that variable exists.

**`AGENTA_API_URL` pointing at that same domain.** The hosted install composes its
redirect URI from configuration, not from the request. If the two disagree, the
manifest points one place and the authorization redirect points another — `F68`.

**All three hosted-app settings, or none.** `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`. The gate needs all three non-empty,
and with any missing the install button does not render at all. A button that is
absent when it was expected is this check, not a bug. The customer-owned flow needs
none of them and stays available either way.

What to register in the app:

```text
request URL    https://<ingress-domain>/api/channels/slack/events/
redirect URL   https://<ingress-domain>/api/channels/catalog/channels/slack/callback/
```

**Open the setup page on the tunnel host, not on `localhost`.** The manifest composes
its request URL from the request that fetched it, so a page browsed on localhost
produces a manifest carrying a localhost request URL. The provider accepts it and no
event ever arrives. That is `F64`, and its symptom is silence.

### Run the written tests before any ceremony

83 tests are written and none has ever executed — the schema they need did not exist
in any running stack. They cost minutes, they run before a single app is created, and
they fail closer to a cause than a manual flow does.

```text
integration   65 collected
acceptance    18 collected
```

Anything they find is cheaper here than after an app exists and a manifest has been
pasted.

## CU-C — what the deployment finds

Budget for it. The first integration run against a real stack found four defects
after C4 and four more after C5. Ledger: the same `tasks-cu-wave6.md`.

This is also where `F53` gets settled for good: with a real workspace and a real
app, capture the `authorizations` block of an ordinary event and of an org-wide
install, and assert against both. Until then the org-wide path stays unproven and
says so.
