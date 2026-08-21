# Design

This is the plan. It says what we build and why. Read `context.md` first for the
problem. Read `research.md` for how things work today.

## Words we use here

- **Agent**: the thing the user builds in Agenta. It runs an AI model and can call tools.
- **Model**: the AI itself (Claude, GPT, and so on).
- **Tool**: an action the model can take, like "send a Slack message".
- **Composio**: an outside service. It stores each user's logins to apps like GitHub
  and Slack, and it runs the tool calls for us.
- **Connection**: one saved login to one app, for example a user's GitHub account.
- **Our backend**: the Agenta API. It holds our secret keys and talks to Composio.
- **The runner and the sandbox**: the runner starts the model in an isolated box (the
  sandbox) and feeds it tools. Secrets must never enter that box.

## The problem in one line

To give an agent GitHub today, we add one setup entry for every single GitHub action.
GitHub has about a hundred actions. So the agent gets a hundred entries, and the model
sees a hundred tool descriptions at once. That is slow, it costs a lot, and it breaks
in several ways (see `context.md`).

## The idea

Store one entry for the whole connection, not one entry per action. Then, when the
agent runs, give the model two small tools instead of a hundred:

- A **search** tool. The model says what it wants, like "create an issue". The tool
  returns the few matching actions and how to call each one.
- A **run** tool. The model picks one action and fills in its inputs. The tool runs it
  and returns the result.

So the model searches, picks, and runs, all in the same turn. It never sees a hundred
descriptions. It sees two tools.

## What the setup entry looks like

One entry names the app and the connection, and says which actions are allowed.

```json
{
  "type": "gateway_toolkit",
  "provider": "composio",
  "integration": "github",
  "connection": "github-main",
  "tools": { "mode": "all" },
  "permission": "ask"
}
```

- `integration` is which app, here GitHub.
- `connection` is which saved login to use. The secret token is not here. Only a name
  that points to it.
- `tools` says which actions are allowed. `all` means the whole app. To allow only some,
  list them: `{ "mode": "include", "actions": ["CREATE_ISSUE", "GET_ISSUE"] }`.
- `permission` is the default: allow, ask the user first, or deny.

We give this entry a new type name, `gateway_toolkit`, so it does not clash with the
old one-per-action entry, which still works.

## How a run works, step by step

1. The agent starts. Our backend turns the one entry into the two tools, search and run.
2. The runner hands both tools to the model, the same way it hands over every other
   tool. Nothing new goes into the sandbox.
3. The model calls search with a description. The call comes back to our backend. Our
   backend asks Composio and returns the matching actions and their inputs.
4. The model calls run with one action and its inputs. The call comes back to our
   backend. Our backend checks the action is allowed, runs it with the saved login, and
   returns the result.

The secret key stays in our backend the whole time. The model only ever sees the two
tools and their results.

## Why we build it this way

- **We reuse what we have.** The two tools travel the same road every other tool
  travels. There is little new code.
- **It works with all three runtimes, including Pi.** The other option we looked at does
  not work with Pi. This one does.
- **The secret key stays on our servers.** It never enters the sandbox. This is the same
  as today.
- **One broken action no longer kills the agent.** If an action cannot run, only that
  one call fails. The model reads the error and tries another action. This fixes #5173,
  because nothing has to resolve up front any more. The current system already got this
  fix (PR #5813).

## Big results

Some actions return a huge amount of text. Today that can flood the model and break the
chat. We cut the result down before it reaches the model, and we add a short note that
tells the model to ask for less (filter, or fetch fewer items). This fixes #5341, and it
is already shipped (PR #5811).

There is a second path that already happens sometimes: a large result is saved to a file
in the sandbox, and the model reads the file instead of getting the whole thing in the
chat. We keep both. The cut-down note is the simple default; the file in the sandbox
handles the cases where the model still needs the full data.

## Versions: why one setting matters

Search and run must use the same version of the app's action list. If they differ,
search can offer an action that run then cannot find, and the user gets a "not found"
error. We fix this by always using Composio's newest version (their v3.1 endpoints).
Then whatever search offers, run can use. This fixes #5174, and it is already shipped
(PR #5814).

## One decision for you

Permissions. We can make the agent ask the user before any action on a connection. That
is easy. Asking before one specific action, like "ask before delete but not before
read", is harder and needs more work, because of how the model calls the run tool. We
suggest shipping the simple version first and adding the specific one later.

## Side idea: let the agent set up its own tools

This is a separate change from the design above, and it could be its own PR. Note it here
so we do not lose it.

When the user builds an agent by talking to it, the agent can set itself up. Today it may
stop and ask the user at each step. We could add a default that lets the agent do this on
its own, with no question to the user:

1. Find an integration, like GitHub.
2. Check which integrations already have a connection (a saved login).
3. If one is connected, add it to the agent and commit.

This is a build-time choice (the agent editing its own setup), not the run-time choice
above (the agent using a tool). We would keep it safe by limiting it: the agent only adds
an integration that is already connected, so it never starts a login flow on its own. We
can decide later whether this is on by default or an opt-in.

## Keeping the key safe

The Composio key is powerful. It can reach every workspace's connections, not just one.
So it must stay on our servers and never enter the sandbox where the model runs. This
plan keeps it there, exactly as today.

## What we chose not to do, and why

We looked at two other shapes and dropped both.

1. **Use Composio "sessions".** Composio offers a ready-made box that holds the action
   filter, the version, the login, and a code sandbox. We do each of those ourselves
   with far less machinery, so we skip the box. We can revisit it later if we want their
   extra features.
2. **Expose the tools as an MCP server.** We would run a small server and let the agent
   connect to it. We dropped it because it does not work with Pi, it needs a heavier
   server, and it would push the secret key closer to the sandbox.
