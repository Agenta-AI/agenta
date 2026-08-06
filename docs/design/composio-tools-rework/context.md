# Context

## What this is

Agenta lets a user give an agent third-party tools, such as sending a Slack
message or reading a GitHub issue. We route those through Composio, a service
that stores each user's connections (their Slack token, their GitHub token) and
runs the tool calls. This document explains why the current design hurts and
what we want instead.

## How it works today, in one paragraph

The user picks tool actions one at a time in the drawer. Each pick writes one
entry into the agent's saved config, for example "Composio, GitHub, GET_AN_ISSUE,
connection github-main". At the start of every run, the Agenta API asks Composio
to resolve each action, one live HTTP call per action, with no cache. The
resolved tool schemas all go to the model, in full, every turn.

## The bugs this causes

- **One dead tool kills the whole run.** Resolution is all-or-nothing. If one
  action no longer resolves, the entire agent fails to start, with an error that
  names no tool. (GitHub issue #5173.)
- **Discovery offers tools that resolution cannot find.** Our discovery path and
  our resolve path hit Composio on different default versions, so a tool that
  discovery shows as ready then fails to resolve with a 404. (#5174.)
- **One huge result wrecks the conversation.** A tool result enters the model
  context with only a 1 megabyte cap. One `get_pull_request` returned about
  241,000 tokens and broke the session. (#5341.)
- **A missing key looks like a missing endpoint.** With no Composio key
  configured, discovery returns a bare 404 that a self-hoster cannot diagnose.
  (#5407.)
- **A toolkit has about 100 actions.** Giving an agent GitHub means adding up to
  a hundred config entries, one per action, and sending a hundred schemas to the
  model every turn. This is slow, expensive, and degrades tool selection.

These are not five unrelated bugs. They are one design choice: we treat each
action as a static, individually resolved tool in the agent's config.

## What we want instead

The agent config names the integration and the connection once, plus a filter
of which tools are allowed. At run start, the Agenta API opens a Composio
session for that connection and exposes it to the harness over MCP. The model
then sees a small set of meta-tools, searches for what it needs, and calls it.
Composio manages the tool versions and the credentials. The heavy per-action
resolution disappears.

## Goals

- Reference an integration once, not one entry per action.
- Remove the all-or-nothing startup failure and the version drift by design.
- Keep large results out of the model context.
- Keep our control point: per-tool permissions, tracing, and a result cap stay
  on our side.
- Keep the Composio credential where it is today, in the Agenta API, never in
  the sandbox.
- Keep warm sandbox reuse intact.

## Non-goals (for the first version)

- Pi over MCP. Pi loads tools through its own extension today; wiring Pi to
  consume MCP servers is later work.
- Per-tenant rate limiting against Composio's per-organization limit.
- Interactive "ask before this one specific action" prompts, if the chosen
  design only supports asking at the meta-tool level. To be decided in design.
- Cost tracking and billing of meta-tool calls.
- A general second tool provider. The design leaves room for one, but we build
  and prove Composio first.

## Fixed facts that shaped the design (from live spikes)

- Calling a Composio session's MCP endpoint needs the project-wide Composio key
  with session-write access. That same access can create and widen sessions for
  any user in the project, so the key can reach every tenant's connections.
  There is no session-scoped credential. So the key must never enter the sandbox.
- Composio sessions do not expire. We create one per connection and reuse it.
- Session filters update in place without changing the MCP URL.
- Composio's own result-trimming hooks do not run over MCP, so the large-result
  fix must be ours.
