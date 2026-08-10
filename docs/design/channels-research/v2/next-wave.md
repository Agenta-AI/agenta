# The next wave

What to build, in dependency order, after the C4 redesign. Supersedes `plan.md`'s
C5 for scope; the checkpoint discipline is unchanged — a checkpoint is a merge point
with a demonstrable behaviour, not a date.

Two checkpoints, because one would repeat the mistake every previous wave made:
too many packages, an exit condition nobody could reach, and a green merge that
proved nothing.

## What decided the split

**Agenta first, Slack second.** Agenta needs no credentials, so it proves the whole
path can be walked. Slack then proves the port holds — the same code reached a
second way. Doing them in the other order means the first channel's shape becomes
the design, which is what happened the first time.

---

## C5 — a message travels the whole path

**Exit condition:** an operator creates a bot in the UI, opens a conversation, sends
a message, gets an answer, and clicks a choice — with **no credentials of any
kind**. `poll_turn` is gone from the tree.

That is C4's unmet exit condition plus a surface to drive it from.

### WP-E1 — session events

Turn started and turn ended, published from `SessionTurnsService` to the internal
queue, with the outbox consuming them and `poll_turn` deleted.

**Not channels work**, and the reason it is first: polling is the fallback the
design accepted only until this landed. Closes `F3` and `F41` — and `F41` matters
independently, because the Redis round trip has never been proven end to end.

Runs in parallel with everything below; nothing here blocks it.

### WP-E2 — the adapter interface

One edit to the frozen interface, so one checkpoint conversation rather than three:

- `installation_hint(body)` → a method taking the **request context** — headers,
  path and body — returning a locator rather than a string
- `verify_signature` declares `connection`, which every adapter already implements
  and the ingress already passes (`F49`)
- `fetch_capabilities` takes the connection, closing the open half of `F45`
- the keyword-only AST guard walks sync methods and derives its count (`F48`)

Blocks every package below it.

### WP-E3 — schema

All three edits land in `oss000000021` in place; nothing is released.

- `channel_connections` with `external_key`, globally unique on
  `(channel, external_key)`, and `ChannelKeyGrain.CONNECTION` (`F46`)
- `channel_grants` gains `effect` and `kind`, `space_id` becomes nullable, with the
  two partial unique indexes the nullability forces (`F51`)
- `CHANNEL_SECRET` added to `secretkind_enum`, with the nested per-channel inner kind

Migration checked by hand against Docker Postgres, never in pytest.

### WP-E4 — the connections write path

The route that does not exist and everything waits on: create, edit, archive a
connection; store credentials as a `CHANNEL_SECRET` row referenced by it; verify
before storing.

Closes `F6` and `F47`, which are the same gap seen twice.

### WP-E5 — the Agenta adapter

Registry entry, capability declaration, `connection_locator` from the request,
verification by session, `parse_event`, `post_message`, `discover_spaces`. Plus
`/channels/agenta/events/` — a literal route deliberately absent from
`_PUBLIC_ENDPOINTS` — and the read route.

**The test that matters here is not that it works.** It is that nothing between the
inbox row and the posted answer branches on the channel.

### WP-E6 — the Agenta UI

Behind a per-user feature flag, using the mechanism that already carries two.
Pick a bot, open a conversation, type, read, click a choice. Deliberately unpolished.

Throwaway; the API it drives is not.

### WP-E7 — button parsing

`block_actions` parsing and the event kind, designed against Agenta's own choice
route first so the mechanism is not shaped by Slack's payload (`F38`).

### WP-E8 — the guards that are lying

Cheap, and each one currently reads as coverage it does not provide: the mock
adapter missing from a composition root and a queue with no producer (`F42`, `F43`),
the vestigial locators and the bug in one that cannot bite (`F50`, `F28`), and Slack
bypassing the capability normaliser.

---

## C6 — Slack, both app models, DMs included

**Exit condition:** an operator sets up Slack from the manifest link, pastes two
values, and gets an answer to a **direct message** — the case that is broken today.
Separately, a second operator installs the Agenta Slack app via OAuth and reaches
the same result. The bridged path agrees with the in-process one.

### WP-S1 — Slack setup, customer-owned

The setup page: manifest to copy, the pre-filled link, the paste form, `auth.test`
verification, and the installed-manifest hash so drift is visible rather than
silent.

`build_slack_manifest` already exists and is correct; this gives it a caller.

### WP-S2 — Slack setup, Agenta-owned

**Newly decided, and not yet designed.** The OAuth flow — redirect, state, token
exchange via `oauth.v2.access` — plus the app we operate, and the capability
declaration that says a shared app cannot offer per-customer commands, modals or
event subscriptions. Without that declaration a user enables a command on a managed
connection and it silently never fires.

Design before building; `provisioning.md` §0 sketches it and no more.

### WP-S3 — grants in the configuration surface

The three questions rather than one list: DMs, group chats, which channels. Plus
denials. This is what makes DMs work, and it is a UI over rows C5 already created.

### WP-S4 — the bridge, re-verified

The two-bridge test and the in-process-versus-bridged comparison, against the new
connection identity.

---

## What is still not clear

Stated so it is not mistaken for settled:

- **Where the setup pages live in web.** The bot chat is behind a flag; provisioning
  is real UI and needs a real home.
- **Whether the Agenta chat replaces or sits beside the existing agent chat.** If a
  channel conversation is a session and the web chat is a view onto a session, these
  may be one surface with two entry points — which would make the real version a
  re-plumbing rather than a new page.
- **The hosted-app OAuth design** (WP-S2), which the decision to build it just
  opened.
- **`architecture.md` §8.1 is now wrong.** It says there is no shared vendor app to
  compromise; there will be one. The security posture needs rewriting to say what is
  true of each model rather than claiming the stronger one for both.

## Sequencing

```text
WP-E1  ────────────────────────────────  (parallel, not channels)

WP-E2 ──┬── WP-E3 ── WP-E4 ──┬── WP-E5 ── WP-E6 ── WP-E7
        │                    │
        └── WP-E8            └────────────────────────────  C5
                                              │
                       WP-S1 ── WP-S3 ── WP-S4 │
                       WP-S2 (design first) ───┴──────────  C6
```

WP-E2 and WP-E3 are the bottleneck and should be one person's first move. WP-E1 has
no dependency on any of it and should start at the same time, because it is the item
that has slipped every wave so far.
