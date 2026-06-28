# Default agent config (playground build kit)

The platform tools, the Agenta authoring skill, and the build permissions are a Playground
build kit. The frontend injects them into the run when the user works in the playground, so
the agent can build and improve itself. The backend only exposes the kit's information through
`/inspect`. The agent service stays dumb: it runs the agent template it receives. The kit is
shown read-only, toggled as a whole, and never committed. The published agent ships with only
the user's own config.

## Files

- `design.md`: the design. The corrected model (the frontend injects, the backend informs,
  the service stays dumb), the `/inspect` `build_kit` descriptor and how the frontend reads and
  injects it, the frontend run-and-commit logic, the advanced-drawer UI folded in, what the
  backend explicitly does not do, the interface notes, and the change set.
- `research.md`: the code trace behind the design. Where the default comes from, how platform
  tools and skills are shaped, the run path, and the commit path. Code facts still valid; the
  approach pivoted (see status).
- `status.md`: the pivot from the rejected backend-injection model, the fixed contract, open
  questions, and coordination.

## In one line

The frontend reads a read-only `build_kit` descriptor from `/inspect`, injects its skills,
tools, and permissions into `parameters.agent` on a kit-on run, and leaves them out on commit.
The backend only describes the kit. The service never knows it exists.
