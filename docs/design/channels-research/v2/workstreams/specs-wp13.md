# WP13 — Web app

Delivers the configuration surface for WP8: connections, the agent roster,
spaces and their rules, grants — the screens an operator uses to wire up a
channel without calling the API directly. Every screen that shows a policy
setting also shows which level decided it, because policy is stated at three
levels and resolved against two more (D25) and a checkbox that cannot explain
itself is a defect, not a simplification.

## Files

New, entirely within WP13's own repo area (`workstreams/README.md`: "own repo
area entirely" — no other package touches these paths):
- `web/oss/src/components/pages/settings/Channels/` — top-level settings page,
  mirroring `web/oss/src/components/pages/settings/Triggers/`
- `web/oss/src/components/pages/settings/Channels/components/` — per-section
  components (connections, agents, spaces, grants), mirroring
  `Triggers/components/{GatewayTriggersSection,GatewaySubscriptionsSection,GatewaySchedulesSection}.tsx`
- `web/oss/src/state/channels/` — atoms/hooks/selectors for the WP8 API,
  mirroring `web/oss/src/state/workflow/`
- Generated API client additions under
  `web/packages/agenta-api-client/src/generated/api/resources/channels/` —
  regenerated from WP8's `operation_id`s, not hand-written

Nothing outside `web/` is touched. WP13 depends on WP8 only through the HTTP
contract; it does not import WP8's Python models.

## Interfaces

Screens, each backed by the WP8 routes named:

- **Connections list** — the installed platform apps (shared
  `gateway_connections` rows, channel-scoped view). Read-only here: install flow
  is the platform's existing connection creation path, not a new one this
  package builds. Backed by `query_channel_connections`.
- **Agent roster** (per connection) — list of `channel_agents`: slug, bound
  reference, active flag, default flag. Create/edit form for slug, header,
  reference, policy, flags. "Set as connection default" action. Backed by
  `list_channel_agents` / `query_channel_agents`, `create_channel_agent`,
  `fetch_channel_agent`, `edit_channel_agent`, `delete_channel_agent`,
  `set_channel_agent_default`.
- **Space list + discovery** (per connection) — configured `channel_spaces` plus
  a "discover" picker over places the app can see but nobody has configured yet
  (`ChannelSpaceCandidate`, `is_configured` flag distinguishes the two in one
  list). Choosing a candidate creates the space row. Backed by
  `list_channel_spaces` / `query_channel_spaces`, `discover_channel_spaces`,
  `create_channel_space`, `fetch_channel_space`, `edit_channel_space`,
  `delete_channel_space`.
- **Space detail** — header, kind (`private`/`group`/`topic`), policy editor
  (see Contracts below), grants in this space with the default-agent picker.
  Backed by `fetch_channel_space`, `edit_channel_space`,
  `query_channel_grants`, `set_channel_grant_default`.
- **Agent detail** — header, references, policy editor, spaces this agent is
  granted in. Grant create/edit/delete lives here as well as on the space
  detail screen (same underlying `channel_grants` rows, two entry points).
  Backed by `fetch_channel_agent`, `edit_channel_agent`, `query_channel_grants`,
  `create_channel_grant`, `edit_channel_grant`, `delete_channel_grant`.
- **Policy explain** — a read-only panel embedded in both the space and agent
  detail screens (not a separate route): for the pair currently in view, calls
  `resolve_channel_policy` and renders each of the four fields
  (`triggers`, `session_scope`, `backfill`, `forwardfill`) next to the level
  that decided it. This is the screen the central requirement (below) is about.
- **Thread browser** (debugging surface, per D24) — read-only list of
  `channel_threads`, filterable by space/agent, with a "close" action mapping
  to `!new`. Backed by `query_channel_threads`, `close_channel_thread`.
- **Inbox/outbox observability** (debugging surface) — read-only event logs,
  filterable, for diagnosing a stuck or skipped message. Backed by
  `query_channel_inbox_events`, `query_channel_outbox_events`.

## Contracts this package must honour

- **Every policy setting shown must show `decided_by`.** `ChannelEffectivePolicy`
  carries `decided_by: Dict[str, ChannelPolicyLevel]`, one entry per field
  (`triggers`, `session_scope`, `backfill`, `forwardfill`), naming which of
  `capability | channel | agent | space | grant` decided that field
  (`entities.md` §4, D25). This is the package's **central requirement, not a
  nicety**: the policy editor on the agent and space detail screens is not a
  bare set of checkboxes and dropdowns — each control is paired with an
  indicator naming the deciding level, sourced from `resolve_channel_policy`
  called against the specific agent/space (and, where relevant, grant) pair in
  view. A control whose level is `capability` renders disabled with an
  explanation ("Telegram does not support history fetch"), because no policy
  can turn that on. A control whose level is a level *other than the one being
  edited* renders enabled but annotated ("off — the agent disables this"),
  because editing the current level cannot change the outcome without also
  changing the level that actually decided it. Without this, a toggle that
  silently does nothing is indistinguishable from a toggle that works, and D25
  guarantees that situation is common — a narrow permissive setting is
  routinely overridden by a broader denial and there is deliberately no
  override flag to fix it with.
- **Policy is written at the level being edited, never resolved-and-reapplied.**
  The agent detail screen's policy form edits `ChannelPolicy` on
  `channel_agents.data.policy` via `edit_channel_agent`; the space form edits
  the space's; the grant form (reached from either detail screen) edits the
  grant's. None of these ever POSTs an effective/resolved document back —
  `ChannelEffectivePolicy` is never a request body (`entities.md` §6), only a
  response.
- **Unstated is a real, distinct value from stated-false.** The policy form
  must let a field be cleared back to "no opinion" (`None`), not just toggled
  between two boolean states, because D25's intersection treats the two
  differently — this is a three-state control (unstated / true / false) for
  booleans and an optional-enum control for `session_scope`, not a plain
  checkbox.
- **Full-PUT edits.** `ChannelAgentEdit`, `ChannelSpaceEdit`, `ChannelGrantEdit`
  require `data` and `flags` outright (`entities.md` §4). The web app sources
  the full current document from the just-fetched entity and overrides only the
  fields the form owns, per the house edit discipline — it never sends a
  partial policy patch.
- **No create form for threads, inbox events or outbox events.** The thread and
  event browsers are read-only plus the one `close_channel_thread` action;
  WP8 exposes no create route for any of the three, and this package does not
  invent a client-side workaround (e.g. no "new thread" button).
- **The ingress route is invisible here.** Nothing in this package calls or
  references `POST /channels/slack/events/` (and `/channels/bridge/events/`) — that endpoint has no session and this
  is a session-authenticated app.

## Tests

- A fixture where the capability declaration denies `backfill` renders that
  control disabled with `decided_by = capability`, regardless of what the
  agent, space or grant policy documents state.
- A fixture where the agent policy states `forwardfill: false` and the space
  policy states `forwardfill: true` renders the space-level checkbox as
  enabled-but-inert, annotated with `decided_by.forwardfill = agent` — proving
  the UI does not just render the space's own stated value.
- Clearing a boolean field back to "no opinion" round-trips as `None` in the
  PUT body, not `false`.
- Editing one field of an agent's policy sends the full `ChannelAgentEdit`
  document (`data` and `flags` both present), sourced from the last fetch.
- The space discovery list renders `is_configured=true` candidates distinctly
  from unconfigured ones, and choosing an unconfigured candidate calls
  `create_channel_space`, never `edit_channel_space`.
- `set_channel_agent_default` / `set_channel_grant_default` are triggered by a
  dedicated action, not by the generic edit form — the edit form for an agent
  or grant has no raw `is_default` checkbox that calls `edit_*`.
- No route in this package renders a create button for threads, inbox events or
  outbox events.

## Out of scope

- WP8 — the API this package calls; WP13 never re-implements policy
  intersection client-side, it always calls `resolve_channel_policy`.
- WP6 — the Slack-specific installation/manifest flow; the connections screen
  here is read-only over connections created elsewhere.
- WP9 — in-conversation commands (`!new`, `!stop`); this package's "close
  thread" action is the same effect reached from the web instead.
- WP10 — fill/backfill; the space policy editor exposes the `backfill` and
  `forwardfill` fields but does not implement or visualize the fetch itself.

## Checkpoint

WP13 feeds **C4 — It is pleasant**. Merges WP9, WP10, WP13; needs C3, and WP0
for WP5's final form.

> **Exit condition:** each command works in a real space; messages sent between
> mentions arrive as context on the next trigger; the flag — never a count of
> `PULLED` rows — guards the one-time fetch, and a refusal leaves it false.
> WP5's polling is deleted, not disabled.

WP13's share of that exit condition is implicit rather than named line-by-line
in the quoted text — it is grouped into C4 because "none of them is on anyone
else's critical path and each can slip without blocking the others"
(`plan.md`, WP13 section). The concrete demonstrable behaviour for WP13's own
slice is: an operator can perform every configuration action in
`specs-wp8.md`'s Interfaces table from the web app, and every policy control
shown is paired with the level that decided it.

## Web app hits WP14's wall independently

`architecture.md` §7 and `plan.md`'s WP14 section both note that the web app,
like the channels inbox worker, will hit the session-refuses-an-overlapping-turn
behaviour (see `specs-wp14.md`). That is not a defect in this package to work
around — it is WP14's justification, restated: this package has its own reason
to want input sequencing, independent of channels.
