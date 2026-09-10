# Research

## Current release implementation

The original proposal predates two changes already on `release/v0.114.4`:

- `823cba5144` removed the `pi_agenta` experiment. Old configurations now resolve to Pi.
- `3c21ca2319` separated gateway guidance from author fields using `gatewayGuidance`.

The SDK's `adapters/harnesses.py` calls `gateway_guidance_field` from
`adapters/agenta_builtins.py`. The resulting `GatewayGuidance` DTO holds `text` and
`carrier`. Pi selects `appendSystemPrompt`; Claude and Codex select `agentsMd`.
`utils/wire.py` serializes this value, with its shape mirrored in `wire_models.py`.

The runner's `engines/sandbox_agent/run-plan.ts` inserts this generated text before
author text. `session-identity.ts` and `lifecycle/desired-state.ts` deliberately omit
it: integration-name changes must not evict warm environments. The guidance already
tells the agent to use tool discovery as the current source of truth.

## Existing environment guidance

The runner composes mount and other environment facts after acquisition. It already
uses instruction files and, for some mount guidance, Pi append-system text and Claude
session metadata. Those paths are independent of the SDK cleanup and remain intact.

## Scope consequence

The required change is an extension of the existing generated-text field. It does
not require new harness capabilities or a session persistence design. Replace the
SDK wrapper with a string, add the common base, and retain runner compatibility for
old SDK requests during rollout.
