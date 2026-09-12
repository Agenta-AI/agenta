# Waves 5 and 6

What to build after the C4 redesign. Supersedes `plan.md`'s C5 for scope; the
checkpoint discipline is unchanged.

**A wave runs from one checkpoint to the next**, and has a shape:

```text
CU-A  →  packages  →  merge  →  CU-B  →  deploy  →  CU-C  →  Ck reached
```

The clean-up phases are not padding. Across the last wave they produced 13 findings
against the packages' 14, so a plan that lists only packages understates the work by
about half.

**Two checkpoints means two waves.** Wave 5 reaches C5; wave 6 reaches C6.

## Why Agenta before Slack

Agenta needs no credentials, so it proves the whole path can be walked. Slack then
proves the port holds — the same code reached a second way. The other order makes
the first channel's shape into the design, which is what happened the first time.

---

## Wave 5 → C5

**Exit condition:** an operator creates a bot in the UI, opens a conversation, sends
a message, gets an answer, and clicks a choice — with **no credentials of any
kind**. `poll_turn` is gone from the tree.

That is C4's unmet exit condition plus a surface to drive it from.

### Wave 5 · CU-A — before any package

Two kinds of debt, both of which corrupt the packages if left.

**The guards that lie.** Each currently reads as coverage it does not provide, and
packages will be written against them:

- the keyword-only AST check cannot see sync methods and hardcodes its count (`F48`)
- the mock adapter is missing from a composition root; a queue has no producer
  (`F42`, `F43`)
- Slack bypasses the capability normaliser entirely, so its declaration is never
  clamped and it declares a `max_chars` the design says is wrong
- `space_locator` and `thread_locator` are written by every adapter and read by
  none, with a filed bug in one that cannot bite (`F50`, `F28`)

**The reconciliation debt.** Five documents carry superseded material and still read
as current. Package specs get written from these, so this is a prerequisite rather
than tidying — the last round of designing started from stale premises for exactly
this reason. `entities.md` §1 and §2.5, `provisioning.md`, `capabilities-v2.md` §1,
and `architecture.md` §8.1, which is now false because a shared vendor app is in
scope.

### Wave 5 · packages

**WP-E1 — session events.** Turn started and turn ended published from
`SessionTurnsService`, the outbox consuming them, `poll_turn` deleted. Closes `F3`
and `F41`.

Not channels work, depends on nothing here, and **starts on day one** — it is the
item that has slipped every wave.

**WP-E2 — the adapter interface.** One edit to a frozen interface, so one
conversation rather than three: the request context replacing
`installation_hint(body)`; `verify_signature` declaring the `connection` every
adapter already takes (`F49`); `fetch_capabilities` taking the connection, closing
the open half of `F45`.

**WP-E3 — schema.** All edits land in `oss000000021` in place, nothing being
released: `channel_connections` with a globally-unique `external_key` and the
`CONNECTION` grain (`F46`); grants gaining `effect` and `kind` with `space_id`
nullable and the partial indexes that forces (`F51`); `CHANNEL_SECRET` with its
nested per-channel kind.

Checked by hand against Docker Postgres, never in pytest.

**WP-E4 — the connections write path.** Create, edit, archive; credentials stored as
a `CHANNEL_SECRET` row referenced by the connection; verified before stored. Closes
`F6` and `F47`.

**WP-E5 — the Agenta adapter.** Registry entry, declaration, `connection_locator`
from the request, verification by session, parse, post, discover. Plus
`/channels/agenta/events/`, deliberately absent from `_PUBLIC_ENDPOINTS`, and the
read route.

The test that matters is not that it works — it is that nothing between the inbox
row and the posted answer branches on the channel.

**WP-E6 — the Agenta UI.** Behind the per-user flag mechanism that already carries
two. Pick a bot, open a conversation, type, read, click. Deliberately unpolished,
and throwaway; the API it drives is not.

**WP-E7 — button parsing.** `block_actions` and the event kind, designed against
Agenta's own choice route first so the mechanism is not shaped by Slack's payload
(`F38`).

```text
WP-E1 ─────────────────────────────────────────  (independent)

WP-E2 ── WP-E3 ── WP-E4 ── WP-E5 ── WP-E6
                              └───── WP-E7
```

WP-E2 and WP-E3 are the bottleneck and are one person's first move.

### Wave 5 · CU-B, deploy, CU-C

**CU-B** is where the reachability check happens: every new symbol grepped for
callers outside its own module. Four disconnections have been missed twice by green
merges, so this is not optional and not satisfied by a passing suite.

**Deploy** is a checkpoint activity and belongs to whoever operates the stack.

**CU-C** is what the deployment finds. The first integration run against a real
deployment found four defects last time; budget for it rather than treating it as
slack.

### Design done during wave 5, for wave 6

**The hosted-app OAuth flow.** Newly in scope, and `provisioning.md` §0 sketches it
and no more: redirect, state, token exchange via `oauth.v2.access`, the app we
operate, and the declaration that a shared app cannot carry per-customer commands,
modals or event subscriptions — without which a user enables a command on a managed
connection and it silently never fires.

Designing it while wave 5 builds is what keeps wave 6 from starting with a blocked
package.

> **Done, late — at the start of wave 6 rather than during wave 5.**
> [`hosted-app.md`](hosted-app.md) carries the flow and `decisions.md` carries
> `D32`–`D36`. The delay cost nothing only because it was caught before WP-S2
> started. It also found what the sketch could not see: the signing secret is per
> *app*, so a hosted connection stores a bot token and nothing else, and signature
> verification sources its secret from two places.

---

## Wave 6 → C6

**Exit condition:** an operator sets up Slack from the manifest, pastes two values,
and gets an answer to a **direct message** — the case that is broken today.
Separately, a second operator installs the Agenta Slack app via OAuth and reaches
the same result. The bridged path agrees with the in-process one.

### Wave 6 · CU-A

Whatever wave 5's deployment surfaced, plus the Slack-specific guards: the contract
suite calling adapters the way the composition root builds them rather than the way
tests find convenient. That is the defect shape this project has now found four
times.

### Wave 6 · packages

> **Specified.** WP-S1 to WP-S4 are `WP26` to `WP29` in that order, with a spec and
> a task list each; [`workstreams/wave6.md`](workstreams/wave6.md) carries the
> merge points, file ownership and collisions. Two things below changed once the
> code was checked rather than the ledger: `F51` is already fixed, so WP-S3 is a
> configuration surface rather than a mechanism, and the manifest WP-S1 hands out
> is reachable only through a connection that cannot exist yet (`F62`).

**WP-S1 — Slack setup, customer-owned.** The manifest to copy, the pre-filled link,
the paste form, `auth.test` verification, and the installed-manifest hash so drift
is visible rather than silent. `build_slack_manifest` already exists and is correct;
this gives it a caller.

**WP-S2 — Slack setup, Agenta-owned.** The OAuth flow designed during wave 5, plus
the per-connection capability difference declared.

**WP-S3 — grants in the configuration surface.** Three questions rather than one
list — DMs, group chats, which channels — plus denials. This is what makes DMs work,
over rows wave 5 already created.

**WP-S4 — the bridge, re-verified.** The two-bridge test and the
in-process-versus-bridged comparison, against the new connection identity.

### Wave 6 · CU-B, deploy, CU-C

As above. C6 is also the gate on publishing the wire contract externally, which
`plan.md` ties to a non-Slack channel shipping on it — so publishing waits for
Telegram regardless of what C6 demonstrates.

---

## Still not clear

- **Where the setup pages live in web.** The bot chat is behind a flag; provisioning
  is real UI and needs a real home.
- **Whether the Agenta chat replaces or sits beside the existing agent chat.** If a
  channel conversation is a session and the web chat is a view onto one, these may be
  one surface with two entry points — a re-plumbing rather than a new page.
- **Telegram**, which is wave 7's obvious content: the cheapest proof that the
  config-time work generalises, and the gate on publishing the contract.
