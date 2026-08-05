# Context

## The problem: the discovery tax

We want users, and harness agents, to build agents on Agenta without reverse-engineering the
API. A common shape is "an agent that does X across two or three SaaS tools." For example:
listen in a Slack support channel, search GitHub issues, file a new issue, reply in Slack.

When a capable agent was asked to wire that with the current API, it produced roughly twenty
calls, mostly sequential and dependent on each other:

- list providers, then search integrations for `slack`, then for `github`
- list actions in each integration by keyword, guessing the query terms
- fetch each action's schema one by one
- list trigger events for the Slack message family, fetch the event schema
- query existing connections per integration
- create connections per integration
- resolve the tools, then start calling them

Every step depends on the previous one, so they cannot be parallelized from the agent side.
The agent also has to guess Composio slug names (`SLACK_SEND_MESSAGE`, `GITHUB_CREATE_AN_ISSUE`)
and stitch three separate concerns by hand: which action, does a connection exist, what is its
schema. That is slow, brittle, and expensive in tokens and round trips. See
[`use-case-walkthrough.md`](use-case-walkthrough.md) for the full before picture.

## The finding that reframes the work

Composio already solved the hard part. Their `COMPOSIO_SEARCH_TOOLS` meta-tool takes
natural-language use cases and returns, in one call: the matched tools and alternatives, the
full input schemas, an ordered execution plan, known pitfalls, and the per-user connection
state. It does the semantic ranking itself, so we do not build embeddings or a reranker. And
it runs through the plain REST execute endpoint we already use, so no MCP session is needed.

The verification is in [`research.md`](research.md). The key mapping: Composio's `user_id` is
the Agenta `project_id`, so the connection state it returns is the calling project's real
state.

## Goals

- One agent-facing tool, `find_capabilities`, that turns a list of natural-language use cases
  into a wired plan: Agenta tool configs, per-integration connection state, and operating
  guidance for the agent being created.
- The output speaks Agenta. No Composio slugs, `connected_account_id`, or "toolkit" leak as
  the primary interface. The agent works with Agenta integrations, actions, connection slugs,
  and `GatewayToolConfig`.
- Collapse the ~20-call discovery into one discovery call plus, at most, a connection create
  per missing integration.
- Make the three connection paths explicit in the result: reuse an existing connection,
  initiate a new one (return a redirect for a human to finish), or ask the user for input.

## Non-goals

- Building our own semantic search or embedding index. Composio's search is the engine.
- Any reranking on our side (explicitly out, per the brief).
- Completing OAuth automatically. A human finishes the grant; the tool surfaces the redirect.
- The `create_workflow` / `invoke_workflow` tools. Those are designed and verified in
  [`../agent-creation-skills`](../agent-creation-skills) (PR #4863); this project feeds them.
- Trigger subscriptions (the Slack "listen" side). The same pattern extends to triggers, but
  the first slice scopes to action tools. See open decision D5 in [`status.md`](status.md).
