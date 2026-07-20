# Pi OpenAI-compatible models

This project makes a vault `custom_provider` connection usable by the Pi harnesses when the
endpoint implements OpenAI Chat Completions. It keeps the current vault and `/run` schemas, gives
the existing `custom` provider kind the product label **OpenAI-compatible**, and translates the
resolved connection into Pi's native `models.json` format inside the runner.

The implementation is intentionally narrow. It establishes one clean service-to-runner path for a
resolved model connection without introducing a general provider protocol framework. A later
Anthropic Messages implementation can add a second translation beside the OpenAI-compatible one.

## Documents

- [context.md](context.md) explains the problem, goals, non-goals, and boundaries.
- [research.md](research.md) records the current UI, service, wire, runner, and Pi behavior.
- [design.md](design.md) defines the proposed behavior and the decisions behind it.
- [plan.md](plan.md) breaks implementation into reviewable phases.
- [qa.md](qa.md) defines unit, contract, integration, and live acceptance coverage.
- [status.md](status.md) is the source of truth for progress and open decisions.

## Decision summary

1. Keep `custom_provider.data.kind = "custom"`; change only its user-facing label to
   **OpenAI-compatible**.
2. Keep the current `ModelRef`, `ResolvedConnection`, `Endpoint`, `secrets`, and `/run` wire
   fields. No persistent or wire schema migration is required.
3. Interpret a provider-less named `custom` connection as provider family `openai`. Preserve an
   explicit provider family for existing connections, including Anthropic gateway configurations.
4. Validate named connections after vault resolution against the combination of provider family
   and deployment. Do not add a wildcard provider capability.
5. For Pi plus `provider=openai` plus `deployment=custom`, generate an isolated `models.json` with
   `api: "openai-completions"` and an environment reference to `OPENAI_API_KEY`.
6. Keep Claude's existing connection translation unchanged. Add regression tests around it.
7. Fail the run if a selected custom endpoint cannot be validated or materialized. Never fall back
   to the default OpenAI endpoint or a different model.

## Relationship to earlier work

The older [model-config project](../model-config/) established that Pi needs `models.json`. Its
paths and several premises predate the current `services/runner` architecture, strict model
selection, least-privilege connection resolution, and warm Daytona sessions. This workspace is the
current implementation plan for the remaining OpenAI-compatible slice.

