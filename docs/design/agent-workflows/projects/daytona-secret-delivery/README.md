# Daytona secret delivery for agent sandboxes

This workspace designs a consumer-scoped credential contract and Daytona Secret delivery for
agent sandboxes. It extends the broader [`secret-isolation`](../secret-isolation/README.md)
project without copying the Agenta vault into Daytona.

## Recommendation

Use one resolved contract for local and Daytona runs. Each model or HTTP MCP consumer owns its
route and credential bindings. The local provider materializes plaintext as it does today. The
Daytona provider creates a unique organization Secret for each sandbox binding and gives the agent
only a host-scoped placeholder.

Support opaque HTTP credentials whose destination is known before sandbox creation. This includes
standard model API keys, Azure OpenAI keys, custom-provider API keys, HTTP MCP authorization, and
potentially Bedrock bearer tokens. It does not include AWS SigV4 keys, Vertex service-account
configuration, private keys, or other values that code must use locally.

Unsupported credentials may keep the current plaintext behavior only through an explicit
non-isolated mode. Failure of isolated delivery never falls back silently. A gateway remains the
general solution when plaintext must stay outside both local and Daytona sandboxes.

## Files

- [`context.md`](context.md): problem, goals, threat model, and scope.
- [`research.md`](research.md): current code, external behavior, credential feasibility, and
  dependency risk.
- [`design.md`](design.md): resolved contract, provider materialization, lease lifecycle, and
  alternatives.
- [`plan.md`](plan.md): implementation phases and rollout sequence.
- [`qa.md`](qa.md): security, contract, provider, lifecycle, and live verification matrix.
- [`open-questions.md`](open-questions.md): decisions required before implementation starts.
- [`status.md`](status.md): current recommendation, constraints, and next action.

## Current state

Planning only. No runtime dependency or production behavior changes in this PR.
