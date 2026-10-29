# Hosted subscription connections

> Historical v0 proposal. This is a good starting point, but it may miss important
> requirements and design questions. Its choices are not approved requirements.
> Read the [current requirements](../requirements.md) and
> [open design questions](../design-questions.md) before using this proposal.

This folder plans how Agenta could let a user connect a ChatGPT or SuperGrok subscription and use
it for interactive agent turns without putting credentials in an agent working directory.

A provider connection is the durable Agenta record that selects an account and authentication
method. A runner is the private service that starts a model harness. A harness is the program that
communicates with the model and uses tools, such as Codex, Claude Code, or Pi. An authentication
home is a private writable directory where a native harness stores and refreshes its login. A
sandbox is an isolated environment for one agent run. It is not the credential store.

## Reading order

1. [architecture-walkthrough.html](architecture-walkthrough.html) shows the onboarding and backend
   flow together in an interactive walkthrough.
2. [context.md](context.md) explains what Agenta already supports and what remains missing.
3. [research.md](research.md) maps the proposal to current code.
4. [plan.md](plan.md) defines the recommended implementation and delivery order.
5. [status.md](status.md) records open decisions and the current state.
