# Context

> Historical v0 proposal. This is a good starting point, but it may miss important
> requirements and design questions. Its choices are not approved requirements.
> Read the [current requirements](../requirements.md) and
> [open design questions](../design-questions.md) before using this proposal.

## What users can do today

Agenta already supports subscription authentication on a self-hosted local runner. The operator
logs in with Codex, Claude Code, or Pi, mounts the corresponding writable authentication directory
into the runner, and selects a self-managed model connection. Every run resolves that selection to
`credential_mode = "runtime_provided"`. The runner injects no project API key. The native harness
reads and refreshes its own login on the mount.

Codex uses `CODEX_HOME/auth.json`. Claude Code uses
`CLAUDE_CONFIG_DIR/.credentials.json`. Pi uses `PI_CODING_AGENT_DIR/auth.json` and can hold several
provider logins. The runner has a private status endpoint. The agent service removes paths and
account details before returning a status to the frontend.

This already provides the basic behavior seen in Squad for a self-hosted deployment. Different
agent sessions can reuse one subscription login without reusing one sandbox or one conversation.

## What users cannot do today

Agenta Cloud has one deployment-level runner location. It cannot select a private runner and
authentication home for each project or account. The browser also cannot start provider device
authorization and complete a hosted connection. Subscription authentication does not work on the
current Daytona path because the runner deliberately refuses to send runtime login state to a
third-party sandbox.

## Goal

Let a user connect one ChatGPT or SuperGrok account once, select it as an AI provider
connection, and use it for interactive agent turns. The first release limits use to the person who
connected the account and allows one active run per connection. Keep authentication material
outside agent workspaces. Preserve provider refresh updates. Support immediate revocation and clear
health states.

Shared use, schedules, and event-triggered runs can follow after Agenta defines who may spend a
user's subscription when that user is not actively starting the run.

## Non-goals

- Do not pool one subscription across customers.
- Do not bypass provider rate limits, client identity, or intended-use restrictions.
- Do not advertise an unsupported consumer subscription.
- Do not copy refresh tokens into every agent or sandbox.
- Do not send subscription login files to Daytona in the first release.
