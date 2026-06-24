# Provider, model, and connection for agent harnesses

How an agent harness (Pi, Claude Code, Codex) picks its **provider + model** and gets the **right
credential injected**, across the SDK standalone path and the Agenta-connected path.

## The shape in one paragraph

Model intent and its credential connection live together in one **`ModelRef`** in the agent config
(`provider` + `model` + `params` + `connection`). The **connection** is a portable reference (a
project default, self-managed, or a named connection by slug, never a database id) into the
**existing secret vault**, which v1 reuses as the one credential store. A **`ConnectionResolver`**
reads one connection from the vault and returns one least-privilege **`ResolvedConnection`** (env
vars plus a non-secret endpoint) that the harness adapter applies. Which providers and connection
modes a harness can reach is declared in the harness-capabilities table, and the resolver rejects
anything outside it. OAuth subscriptions run self-managed, where Agenta injects nothing.

## Read in this order

1. [context.md](context.md): why this exists, the current state with file:line, goals, non-goals,
   constraints.
2. [research.md](research.md): what the three harnesses do and what Agenta does today, with
   citations.
3. [explainer.md](explainer.md): the plain-language version and what it means for the playground.
4. [design.md](design.md): the formal spec (the three concerns, the resolver port, deterministic
   resolution, security, capabilities).
5. [plan.md](plan.md): the 5-PR stack, backend through frontend.
6. [status.md](status.md): current state, decisions, open decisions, risks.

## Related work in this repo

- [../ports-and-adapters.md](../ports-and-adapters.md): the Backend / Harness / Session ports this
  design extends, and the agent-identity / harness-config / runtime-infrastructure split.
- [../model-config/](../model-config/): how a requested model becomes settable on each harness (the
  Pi `auth.json`/`models.json` write, staged strict-model rollout). This work decides which
  connection's credential that write uses.
- [../harness-capabilities/](../harness-capabilities/): the per-harness capability-table mechanism.
  This work contributes the `providers` and `connection_modes` entries.
- [../capability-config/](../capability-config/): the three permission layers (orthogonal to
  credentials).
- [../sdk-local-tools/](../sdk-local-tools/): the pluggable `SecretResolver` precedent the
  connection resolver reuses.
