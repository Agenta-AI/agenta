# Context: Artifacts

## The model

An artifact is a small, agent-authored web application with one durable directory as its
only capability. The agent writes normal HTML, CSS, and JavaScript. The user opens the
artifact in the playground, interacts with it, and the application persists its state to
the artifact directory. On a later turn, the agent reads that state as ordinary files.

```text
agent <-> artifact directory <-> sandboxed artifact page <-> user
```

This is not a replacement for questions, approvals, or questionnaires. Those remain the
right interface when the agent needs a bounded answer. Artifacts cover work that benefits
from a shared, editable object: a pipeline, plan, CRM, launch board, visual brief, or
lightweight dashboard.

## Proposed folder convention

```text
artifacts/
  launch-plan/
    index.html
    state.json
```

`index.html` is the presentation and interaction code. `state.json` is the durable shared
state. Keeping them separate means a user moving a task does not rewrite the application
itself, and an agent can inspect a small, meaningful file instead of reconstructing state
from rendered DOM.

The artifact root is also the capability boundary. It can read and write only its own
files. It cannot reach the Agenta application, other mounts, browser credentials, or the
general network.

## Goals

- Give agents a way to communicate and collaborate through an interactive object, not
  only chat text or a questionnaire.
- Let agents use the familiar web platform instead of a new generative-UI language.
- Keep the mount as the durable source of truth for collaboration between user and agent.
- Make artifacts easy to discover, expand, inspect, and work with in the playground.
- Give agents repeatable instructions, a toolkit, and templates instead of expecting each
  one to invent a safe artifact from scratch.

## Non-goals

- A general application-hosting platform or arbitrary Internet browser.
- Direct access from artifact JavaScript to Agenta APIs, session credentials, or tools.
- Replacing the existing questionnaire or approval interaction types.
- Automatically waking an agent for every user edit. The initial loop is: edit an
  artifact, then continue the conversation; the agent reads the changed files.
- Implementing this direction in the current design PR.

## Product direction

The playground should have an **Artifacts** surface associated with the agent's files.
It lists artifacts, opens one in a contained work area, and lets the user expand it while
continuing to talk with the agent. The user can inspect the underlying files, but the
primary interaction is the artifact itself.

Initial templates should demonstrate useful collaboration patterns:

- CRM: contacts, opportunities, stages, notes, and next actions.
- Go-to-market workspace: audience, positioning, launch checklist, assets, and owners.
- Project board: tasks, priorities, status, and blockers.

