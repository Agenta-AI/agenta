# Provider, Model, and Auth for Agent Harnesses

How an agent harness (Pi, Claude Code, Codex) picks its **provider + model** and gets the
**right credential injected**, across the SDK standalone path and the Agenta-connected path.

This is a research-and-design workspace. No code has changed yet. Read in this order:

1. [context.md](context.md): why this work exists, goals, non-goals, the questions to answer.
2. [research.md](research.md): what the three harnesses do, and what Agenta does today,
   with file:line and source citations.
3. [explainer.md](explainer.md): the plain-language version of the converged design and what
   it means for the playground.
4. [design.md](design.md): the formal design (the three concerns, the resolver port, security,
   the duplicate-key landmine, multi-account, OAuth handling).
5. [plan.md](plan.md): the stacked-PR plan for the minimal v1, backend plus a small frontend.
6. [status.md](status.md): current state, the converged vocabulary, decisions, open decisions.

## The one-paragraph version

Today the agent runtime carries a bare `model` string and, at run time, dumps **every**
provider key in the project vault into the harness environment. There is no provider concept,
no way to pick between two accounts of the same provider, no custom base URL, and no
model-scoped injection. The redesign splits the problem into three concerns: a neutral
**`ModelSpec`** (`provider` + `model`) that stays portable in the committed agent config; a
**provider account** (a named, multi-account credential) that lives in our vault as a read
view, our infra and not the agent config; and a **`ModelAccessResolver`** port that maps the
selected provider plus a run-chosen account to a single, least-privilege
**`ResolvedModelAccess`** the harness consumes. The chosen account rides the run (a request
override or an environment default), never the committed revision. OAuth subscriptions are
never stored as rotating files; they run self-managed, where Agenta injects nothing.

## Two Codex consults shaped this

The vocabulary and boundaries come from two Codex reviews: an architecture/naming pass and a
CTO pass at xhigh effort. The CTO pass moved the account choice off the committed revision,
turned provider accounts into a read view over the existing vault for v1, and named the
security non-negotiables. [status.md](status.md) records the converged vocabulary and the
decisions.

## Related work in this repo

- [../ports-and-adapters.md](../ports-and-adapters.md): the existing Backend / Harness /
  Session ports this design extends. The "Config Ownership" section already names the
  3-way split (agent identity / harness config / runtime infrastructure) this work fills in.
- [../sdk-local-tools/](../sdk-local-tools/): the pluggable `SecretResolver` precedent the
  model-access resolver reuses.
- [../open-issues.md](../open-issues.md): "Supply secret values to tools during a standalone
  run" is the sibling secret-injection question for tools; this work is the provider-auth
  counterpart.
