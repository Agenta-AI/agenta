# Plan

We build this in three parts. Each part ships and can be tested on its own. Together
they build the design in `design.md`: one setup entry becomes a search tool and a run
tool.

## Part 1: three quick fixes (ship first)

These do not need the redesign. The first two remove pain we have today. The third is
needed before Part 2 can work.

- **Cap big results (#5341).** Cut a tool result down to a safe size before it reaches
  the model, and add a note telling the model to ask for less. This also helps the
  current setup.
- **Clear "not set up" error (#5407).** When Composio has no key, return a clear "not
  configured" message instead of a bare "not found".
- **Pin the version (#5174).** Always call Composio's newest version, so search and run
  use the same action list. Part 2 depends on this.

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

## Not in this plan

- Composio sessions and their MCP server. Dropped; see `design.md`.
- Special work for Pi. The two tools already reach Pi the normal way.
- Composio's code sandbox, and saving big results to a file for the model to read. The
  size cap is the first answer.
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
