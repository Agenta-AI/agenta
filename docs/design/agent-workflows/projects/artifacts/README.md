# Artifacts

> **Future direction.** This workspace records a product direction for later review. It
> does not authorize implementation, change the current playground, or add a new agent
> capability.

Artifacts let an agent communicate through a small interactive workspace when a question
or questionnaire is the wrong shape. An artifact is a normal HTML, CSS, and JavaScript
application stored in the agent's durable mount. The user can work in it. Its durable
state is written back to the same mount, so the agent can read it on a later turn.

## Files

- `context.md`: product model, goals, and boundaries.
- `research.md`: current mount and playground facts this direction builds on.
- `plan.md`: future phases for the runtime, agent skill, toolkit, templates, and UI.
- `status.md`: current proposal status and decisions still needed.

## Related work

- `../agent-mounts/`: the planned durable folder per agent.
- `../../../mount-file-viewer/`: the current session-mount browser and preview.

