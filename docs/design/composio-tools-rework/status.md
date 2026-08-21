# Status

Where we are, what we decided, and what is still open.

## Stage

Two tracks.

- **Quick bug fixes to the current system.** Done. All four are merged into
  release/v0.112.0. See "Bug fixes" below.
- **The redesign.** Planned in these documents. Not built yet.

## What we decided

- **Store one setup entry per connection, not one per action.** This fixes the
  all-or-nothing failure, the version mismatch, and the hundred-entries problem by design.
- **Give the model two tools at run time: search and run.** The model finds an action,
  then uses it. It no longer sees a hundred descriptions.
- **Do not use Composio's "sessions".** Their ready-made box holds a filter, a version, a
  login, and a code sandbox. We do each of those ourselves with far less code. See
  `design.md` for why.
- **Always call Composio's newest version (v3.1)**, so search and run agree. This is the
  fix for #5174.
- **Keep the Composio key on our servers.** It can reach every workspace's connections,
  so it must never enter the sandbox.

## Bug fixes (current system, all shipped)

All four are merged into release/v0.112.0.

- **#5341 big results:** merged (PR #5811).
- **#5407 clear "not set up" error:** merged (PR #5812).
- **#5173 one broken tool no longer kills the agent:** merged (PR #5813).
- **#5174 version pin:** merged (PR #5814).

Note on big results: besides the size cap, a large result is sometimes saved to a file in
the sandbox, and the model reads the file. We keep both.

## Open questions

- Does Composio's search return the right actions for our real use cases? Needs a hands-on
  check. See `experiment.md`.
- Can the smallest models handle "search then run" as well as a flat list of tools? See
  `experiment.md`.
- Should we let the user ask before one specific action, not just before any action? This
  needs extra work. It is a product call.
- Should we let the agent set up its own tools (find, check connection, add, commit)
  without asking? A separate, maybe-later change. See `design.md`, "Side idea".
- What happens to agents that still use the old one-per-action setup? We already accept
  both, so they keep working.

## History

Earlier drafts used a Composio session, first driven over plain calls, then behind an MCP
server. We dropped both to keep the design small. A Codex review of those drafts still
holds on the small points (the new setup type, the "which actions are allowed" field, and
the three-part plan), but its session-specific advice no longer applies.
