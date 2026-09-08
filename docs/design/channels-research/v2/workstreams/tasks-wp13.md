# WP13 — Tasks

## Setup

- [ ] Regenerate the API client from WP8's `operation_id`s once WP8 lands (or
      against its stub/interface if starting before C3) — do not hand-write
      request/response types for routes WP8 owns.
- [ ] Scaffold `web/oss/src/components/pages/settings/Channels/` mirroring
      `Triggers/`'s top-level page shape (tabs or sections per entity).
- [ ] Scaffold `web/oss/src/state/channels/` (atoms, hooks, selectors) mirroring
      `web/oss/src/state/workflow/`'s layout.

## Connections screen

- [ ] Read-only list view over `query_channel_connections`, scoped to channel
      provider keys.
- [ ] Empty state links out to the platform's existing connection-creation flow
      (not built here).

## Agent roster + agent detail

- [ ] Roster list: slug, header, active flag, default flag, per connection.
      Backed by `list_channel_agents` / `query_channel_agents`.
- [ ] Create form: slug, header, reference binding, initial policy, initial
      flags. Calls `create_channel_agent`.
- [ ] Detail view: fetch via `fetch_channel_agent`; full-PUT edit form for
      header, reference, policy, flags via `edit_channel_agent`.
- [ ] "Set as connection default" action, separate from the edit form, calling
      `set_channel_agent_default`. Verify the previous default's flag flips to
      false after the call without a manual refetch (or with one — either way,
      assert the roster reflects exactly one default post-call).
- [ ] Delete action calling `delete_channel_agent`, with confirmation.
- [ ] Grants sub-list on the agent detail screen: spaces this agent is granted
      in, via `query_channel_grants` filtered by `agent_id`.

## Space list, discovery, and space detail

- [ ] List view over `list_channel_spaces` / `query_channel_spaces`.
- [ ] Discovery picker: calls `discover_channel_spaces`, renders candidates with
      `is_configured` visually distinguished from configured spaces already in
      the list.
- [ ] Choosing an unconfigured candidate calls `create_channel_space` with the
      candidate's `kind`, `external_key`, `external_locator`. Choosing a
      configured one navigates to its existing detail screen instead of
      creating a duplicate.
- [ ] Detail view: fetch via `fetch_channel_space`; full-PUT edit form for
      header, policy, flags via `edit_channel_space`.
- [ ] Delete action calling `delete_channel_space`, with confirmation.
- [ ] Grants sub-list on the space detail screen: agents granted in this space,
      via `query_channel_grants` filtered by `space_id`, with the
      "set as space default" action calling `set_channel_grant_default`.

## Grant create/edit (reachable from both agent and space detail)

- [ ] Create form: agent + space pickers (pre-filled with the current entity
      when reached from its detail screen), initial policy. Calls
      `create_channel_grant`.
- [ ] Full-PUT edit form for policy and flags via `edit_channel_grant`.
- [ ] Delete action calling `delete_channel_grant`.
- [ ] No raw `is_default` toggle inside this form — default-setting only
      through the dedicated action (task above), never through a generic PUT.

## Policy editor + explain panel (the central requirement)

- [ ] Build the three-state boolean control (unstated / true / false) for
      `backfill` and `forwardfill`, and the optional-enum control for
      `session_scope`, and the multi-select-with-clear for `triggers`.
- [ ] Wire the explain panel: on entering agent detail, space detail, or grant
      create/edit, call `resolve_channel_policy` for the pair in view and
      render `decided_by` next to every field.
- [ ] Disabled-with-reason state for any field whose `decided_by == capability`.
- [ ] Enabled-but-inert annotation for any field whose `decided_by` names a
      level other than the one currently being edited.
- [ ] Verify the panel updates when the form's own draft changes level
      (re-resolve on save, not on every keystroke, to avoid calling the policy
      endpoint on every input event).

## Thread and event browsers (debugging surfaces)

- [ ] Thread list, filterable by space/agent, via `query_channel_threads`.
- [ ] "Close thread" action (the web equivalent of `!new`) via
      `close_channel_thread`.
- [ ] Inbox event log, filterable, via `query_channel_inbox_events`.
- [ ] Outbox event log, filterable, via `query_channel_outbox_events`.
- [ ] No create action anywhere in either browser.

## Verification

- [ ] Capability-denied field renders disabled across every screen that shows
      it (space detail, agent detail, grant form).
- [ ] Agent-denied / space-permits fixture renders the space's control as
      enabled-but-inert with the correct `decided_by`.
- [ ] Clearing a boolean field round-trips as absent/`None`, not `false`, in
      the PUT body.
- [ ] Every edit PUT carries the full `data` + `flags` document, not a partial
      patch.

## Definition of done

An operator can perform every WP8 configuration action from the web app, and
every screen showing a policy setting also shows the level that decided it —
verified by the capability-denied and agent-denied-space-permits fixtures
above, which are the two cases a checkbox-only UI gets wrong.
