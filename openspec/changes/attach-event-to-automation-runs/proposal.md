## Why

An event automation runs an agent when something happens in a connected app, for example
"when a pull request is opened in GitHub, review it". Today the agent gets only the
instruction text the user typed. It does not get the pull request, the email or the Slack
message that started the run, so it cannot do the job.

The cause is in two places:

- The `/m` Instruction field stores static text only. It has no way to refer to the event
  (`web/packages/agenta-entities/src/gatewayTrigger/core/messageInputs.ts:100-118`). The old
  form with an event field picker was deleted in commit `89c2d80c39`.
- The dispatcher sends only what the mapping names
  (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:316-319`). The workaround that builder
  agents are told to use, a sibling `event` input key, is never read by the agent handler
  (`sdks/python/agenta/sdk/agents/handler.py:479`).

## What Changes

- A new subscription option `data.include_event`, on by default and on for every existing
  automation. When it is on, the dispatcher adds the event data to the agent's message. Old
  automations start to work without an edit.
- The dispatcher turns every resolved message text into a string. Without this, a field that
  is a number, an object or absent would fail the run.
- Each subscription delivery records the event it received in `data.event`, so the screen can
  show real values.
- Test-mode captures use the same message as a real run.
- The agent-facing reference text stops telling builder agents to use a sibling `event` key.
- On `/m`, for event automations only, the Instruction field gets:
  - a row of small field tags inside the instruction box, built from the event's payload
    schema, each with a humanized name, the provider's own description on hover, and a check
    on the tags already used;
  - pills: a click on a tag inserts the field into the instruction;
  - a checkbox "Also attach the full event, so the agent can use any detail", on by default;
  - a "What the agent gets" preview, filled from the newest delivery when one exists.
- "Run now" sends the preview text: pills filled from the newest delivery, and the event when
  the option is on.

## Capabilities

### New Capabilities

- `trigger-event-inputs`: how the dispatcher builds the agent's inputs for an event
  automation, including the event text, text coercion and the recorded event.
- `automation-event-fields`: the `/m` Instruction field for event automations: field tags,
  pills, the include-event option, the preview and Run now.

### Modified Capabilities

None. No spec in `openspec/specs/` covers triggers or automations yet.

## Impact

- API: `api/oss/src/core/triggers/dtos.py`, `api/oss/src/tasks/asyncio/triggers/dispatcher.py`,
  `api/oss/src/core/triggers/utils.py`, unit tests in `api/oss/tests/pytest/unit/triggers/`.
- SDK: the reference text in `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`.
- Web: `@agenta/entities/gatewayTrigger` (types and pure helpers),
  `@agenta/entity-ui/gatewayTrigger` (pill composer, field tags),
  `@agenta/automation-ui` (Instruction field, drafts, request body builders), `web/mobile` (Run now).
- Generated client: two Fern type files, regenerated from an EE spec.
- Data: no migration. `data` is a JSON column on both tables. Old rows read the defaults.
- Behavior change for old automations: their agents start to get the event text in the
  message. This is the point of the change.
