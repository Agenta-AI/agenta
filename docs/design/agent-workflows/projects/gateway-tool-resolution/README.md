# Gateway tool resolution: surface failures, stop one dead tool bricking the agent

Planning workspace for issues [#5173](https://github.com/Agenta-AI/agenta/issues/5173)
and [#5174](https://github.com/Agenta-AI/agenta/issues/5174), and QA finding F-019.

One stale Composio action takes down a whole agent, and the error the user sees names
only an HTTP status. This workspace plans two independently shippable fixes: surface the
resolver's real error detail end to end, and stop a single unresolvable tool from failing
the entire turn.

## Files

- `context.md` — why this work exists, the incident, goals and non-goals.
- `research.md` — the verified failure chain through the code, file by file, with the
  exact swallow point and the run lifecycle.
- `design.md` — the three decisions (surface the detail, the failure policy, the
  relationship to #5174) with options and honest trade-offs.
- `plan.md` — phased execution: the contained fix first, then the resilience change, then
  the deferred config-health surface.
- `status.md` — current state, open questions, decisions log. Source of truth for progress.

## Recommended direction (one line)

Ship the surfacing fix now (read the resolve response body in the SDK, name the failing
tool in the run error), then make resolution resilient by dropping only genuinely-absent
actions with a loud warning while keeping connection and auth failures fatal.
</content>
</invoke>
