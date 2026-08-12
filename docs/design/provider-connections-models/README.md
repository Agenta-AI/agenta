# Provider connections and model lists

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

This folder plans how Agenta can treat standard provider keys and custom providers as provider
connections with the same optional model and harness settings.

A provider connection is one configured way to reach a model provider. It has an identity,
credentials, optional endpoint settings, models shown to users, and compatible harnesses. A harness
is the program that communicates with a model and uses tools, such as Pi, Codex, or Claude Code.

Subscription status is separate. It is runtime state detected by the runner and is planned under
`../runner-subscription-status/`. A later frontend can display subscriptions and stored provider
connections in one menu without storing them as the same object.

## Reading order

1. [context.md](context.md) explains the user experience, goal, and scope.
2. [research.md](research.md) explains the current data and code constraints.
3. [data-model.md](data-model.md) defines the compatibility-first connection shape.
4. [plan.md](plan.md) splits the work into dependent pull requests.
5. [status.md](status.md) records open decisions and progress.
