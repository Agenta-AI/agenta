# Custom secrets for agent runs

Agent variants can attach text secrets from the project vault to their sandbox as environment variables. An agent can also pause a conversation with `request_secret`, let the user configure the binding, and continue on the committed revision.

## Reading order

1. [Context](context.md): problem, intended outcome, and milestone boundary.
2. [Contracts](contracts.md): shipped configuration, runtime, and tool interfaces.
3. [Plan](plan.md): implementation sequence and interaction lifecycle.
4. [Simplification](simplification.md): V1 scope decisions and deferred V2 work.
5. [QA](qa.md): automated and runtime acceptance criteria.
6. [Browser checklist](qa-browser-checklist.md): release checks for the user-facing transaction.
7. [Status](status.md): implementation and validation state.

## Shipped V1

V1 includes text custom secrets, environment-variable bindings, project-scoped resolution, runner injection and redaction, shared create and attach UI, an Advanced agent configuration section, and the `request_secret` conversation flow. Bindings persist on an ordinary agent variant revision.

The vault owns secret content. The variant stores only the secret slug and environment binding. The run transport carries resolved values to the runner over the existing protected channel and registers them with existing diagnostic redaction. The [QA notes](qa.md) describe the limits of readable delivery and short-value redaction.

V1 has no service presets, secret templates, session-only grants, delivery-mode picker, host allowlist, or advanced secret metadata. Host-restricted and opaque delivery remain V2 work.

## Terms

A **vault secret** is encrypted project data. A **binding** maps a saved secret to one environment-variable name. A **variant revision** is a saved version of the agent configuration. A **paused turn** waits for a user interaction before the harness continues.

## Tracking

[Issue #5703](https://github.com/Agenta-AI/agenta/issues/5703), also [AGE-4067](https://linear.app/agenta/issue/AGE-4067), tracks custom-secret delivery. The implementation builds on the shared platform-instruction path introduced by [PR #6365](https://github.com/Agenta-AI/agenta/pull/6365).
