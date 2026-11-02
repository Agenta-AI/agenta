# Agent use grants (M8, deferred design note)

Status: NOT IMPLEMENTED. Optional. Build only when a customer asks and the open questions in design.md are resolved.

## Why

After M6, the only way to give another project an agent is to move it. Sometimes the owning project wants to keep the agent and let another project use it. Example: Sales keeps its research agent, its configuration, connections and data, and Marketing members start their own conversations with it.

## What Changes

- Nothing is built in this change. It records the product goal, the constraints any later design must meet, and the unresolved execution semantics (see design.md).
- One normative requirement holds until a later design replaces this note: no grant mechanism lets a non-member of a project run that project's agents.

## Capabilities

### New Capabilities

- `agent-use-grants`: placeholder capability. It states only that use grants do not exist yet.

### Modified Capabilities

None.

## Non-goals

- Any router, DAO, table, UI or permission in this change.
- Fake project membership or a guest role in the home project.
- Grants to single users, to the organization, across organizations, or from or to personal projects.
