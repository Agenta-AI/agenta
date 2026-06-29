# Default agent config (playground build kit)

The platform tools, the Agenta authoring skill, and the build permissions are a playground build
kit, modeled as an **agent-template overlay**: a partial agent template the platform serves
read-only on the simple-applications response (`GET /api/simple/applications/{id}`). The frontend
merges the overlay onto `parameters.agent` on a
playground run so the assistant can build and improve the agent, and leaves it out on commit. The
agent service stays dumb: it runs the template it receives. The published agent ships with only
the user's own config.

## Files

- `design.md`: the design. The overlay model (the frontend merges, the backend serves, the
  service runs as-is), the overlay shape (a partial `parameters.agent`, skills as `@ag.embed`),
  where it lives on the simple-applications response
  (`additional_context.playground_build_kit.agent_template_overlay`), the
  merge semantics, the frontend run-and-commit behavior, the advanced-drawer UI, what the backend
  does not do, the interface notes, and the change set.
- `research.md`: the code trace behind the design. Where the default comes from, how platform
  tools and skills are shaped, the run path, and the commit path.
- `status.md`: where the design stands, the contract for the frontend, open questions, and
  coordination.

## In one line

The frontend reads a read-only `agent_template_overlay` from the simple-applications response,
merges its tools, skill, and sandbox permissions onto `parameters.agent` on a kit-on run, and
leaves them out
on commit. The backend only serves the overlay. The service never knows it exists.
