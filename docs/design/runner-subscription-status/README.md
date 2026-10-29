# Runner subscription status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

This folder plans how Agenta shows whether a runner can use a model subscription.

The runner is the private Node service that starts Codex, Pi, or Claude Code. A harness is the
program that communicates with the model and uses tools. The frontend is the Agenta web application.

## Reading order

1. [context.md](context.md) explains the user problem and the limits.
2. [research.md](research.md) shows the current code path and the code evidence.
3. [api-design.md](api-design.md) defines the proposed response and the new path.
4. [plan.md](plan.md) lists the implementation work in dependency order.
5. [qa.md](qa.md) defines the test cases.
6. [status.md](status.md) records the current state and open decisions.

## Proposed path

```text
Mounted login folder
        ↓
Node runner: inspect local login files
        ↓  authenticated private HTTP
Python agent service: remove private details and return status
        ↓  authenticated public HTTP
Frontend query: cache status for a short time
        ↓
Subscription card: show connected, not found, or unavailable
```

The browser must not contact the runner. The browser must not receive the runner token, file paths,
login tokens, account names, or token contents.
