# Plan

We build this in three parts. Each part ships and can be tested on its own. Together
they build the design in `design.md`: one setup entry becomes a search tool and a run
tool.

## Part 1: quick fixes (done and shipped)

These did not need the redesign. They removed pain in today's system, and the version pin
is also needed before Part 2. All four are merged into release/v0.112.0.

- **Cap big results (#5341).** Cut a tool result down to a safe size, and tell the model
  to ask for less. Shipped, PR #5811.
- **Clear "not set up" error (#5407).** Return a clear "not configured" message instead
  of a bare "not found". Shipped, PR #5812.
- **Broken tool no longer kills the agent (#5173).** Drop the one dead tool, keep the
  rest. Shipped, PR #5813.
- **Pin the version (#5174).** Always call Composio's newest version, so search and run
  use the same action list. Shipped, PR #5814.

## Part 2: one app working end to end (backend)

Build the whole new path for the new setup entry, hidden behind the old path so nothing
breaks for current users.

- Add the new setup entry type and its "which actions are allowed" field.
- Change the backend so one entry produces the two tools, search and run, instead of one
  tool per action.
- Make search ask Composio for matching actions, and make run call the chosen action,
  both with the key that stays on our servers.
- Reject a run call for an action the setup did not allow.
- Let the agent ask, allow, or deny at the connection level, using the controls we
  already have.
- Test it end to end on a real agent runtime: the model searches, runs a tool, gets a
  result, permissions work, a broken action fails on its own without killing the run,
  and a fast restart still works after a setup change.

## Part 3: the setup screen

- The drawer lets the user add one connection entry (app, connection, allowed actions)
  instead of one row per action. The backend from Part 2 already accepts it.

## Possible follow-up (separate, maybe its own PR)

- **Let the agent set up its own tools.** A default that lets the agent find an
  integration, check which ones already have a connection, and add and commit a connected
  one without asking the user. This is a build-time choice, separate from the run-time
  design above. See `design.md`, "Side idea".

## Not in this plan

- Composio sessions and their MCP server. Dropped; see `design.md`.
- Special work for Pi. The two tools already reach Pi the normal way.
- Composio's code sandbox. The size cap, and the existing option to save a big result to
  a file in the sandbox, are enough for now.
- Asking before one specific action.
- Limiting call rate per customer.
- A second tool provider.

## Testing

- Part 1 gets small tests for the size cap and the clear error, plus a check that an
  action found by search can be run after the version pin.
- Part 2's search and run get tests against a real Composio test connection. The end to
  end check uses the agent release gate.
- Two safety tests: the sandbox never gets the Composio key, and a setup change does not
  needlessly throw away a warm sandbox.
