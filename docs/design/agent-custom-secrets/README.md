# Custom secrets for agent runs

Users can save custom secrets and select them for HTTP MCP authentication. They cannot
attach an arbitrary saved token to an agent's shell or skills. This plan adds that flow
for internal use, then adds host-restricted delivery as a separate milestone.

## Reading order

1. [Context](context.md): current behavior, intended outcome, and milestone boundaries.
2. [Plan](plan.md): implementation order and the complete request-card lifecycle.
3. [Contracts](contracts.md): proposed configuration, runtime, and tool interfaces.
4. [Research](research.md): verified implementation entry points and remaining checks.
5. [Simplification](simplification.md): scope reductions and their tradeoffs.
6. [QA](qa.md): observable acceptance criteria before enabling the feature.
7. [Status](status.md): decisions, verification, and handoff.

## Terms

The **vault** stores encrypted project secrets. A **binding** assigns a saved secret to
an environment-variable name. The **runner** starts and manages an agent execution.
A **harness** is the coding agent it drives, such as Pi, Claude, or Codex. A **sandbox**
is the local or Daytona execution environment. An **MCP server** exposes tools through
the Model Context Protocol. A **paused turn** has stopped execution while waiting for
a user interaction. A **workflow revision** is a saved version of the agent configuration.

## Tracking

[Issue #5703](https://github.com/Agenta-AI/agenta/issues/5703), also
[AGE-4067](https://linear.app/agenta/issue/AGE-4067), tracks custom-secret delivery.
This design depends on [PR #6365](https://github.com/Agenta-AI/agenta/pull/6365), which
introduces shared platform instructions. The child implementation must include the
secret-handling guidance described here. This PR changes design documents only.
