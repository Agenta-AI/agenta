# Status: Artifacts

## Current state

Proposed for the future. No runtime, skill, toolkit, templates, or playground UI has been
implemented by this workspace.

## Decisions recorded

- Name: **Artifacts**.
- Storage: artifact files live in the agent's durable mount, under `artifacts/`.
- Authoring model: normal HTML, CSS, and JavaScript. Do not design a proprietary
  generative-UI language.
- Collaboration model: the artifact writes durable files; the agent reads those files on
  a later turn.
- Product boundary: artifacts complement questionnaires. They are for shared interactive
  work, not bounded answers.
- Enablement: implementation includes a dedicated agent skill and an artifact build
  toolkit with templates.

## Open questions

- Is `localStorage` mirroring, relative file `fetch`, or both the first persistence API?
- Does the first release allow writes only to `state.json`, or to any file inside the
  artifact root with version protection?
- Which isolated-origin and content-security-policy design meets the required browser
  security boundary?
- Where does the Artifacts work area live in the playground when no inspector is open?
- Should the next agent turn receive only changed paths, or a small system note that an
  artifact changed?

## Next step

Review this direction with the agent-mount and playground owners. If approved, make a
separate implementation plan that settles the runtime security model before frontend work.

