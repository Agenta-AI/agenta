## Context

Terms:

- **Subscription**: the backend row behind an event automation (`TriggerSubscription`).
- **Mapping**: `data.inputs_fields`, a JSON template. The dispatcher resolves it against the
  event context and sends the result as the agent's inputs.
- **Selector**: a mapping leaf that starts with `$` (JSON Path) or `/` (JSON Pointer).
- **Event context**: `{event:{event_id,event_type,timestamp,created_at,attributes}, subscription, scope}`.
  `event.attributes` is the provider's event payload.
- **Delivery**: one row per event that reached a subscription. It records the inputs sent.
- **Pill**: a chip in the instruction text that stands for one event field, stored as a selector.
- **Payload schema**: the JSON Schema of the event payload that the provider publishes. The
  catalog route returns it as `payload`.

Today, with evidence (full notes in the research file of this build):

| Area | Today | Evidence |
| --- | --- | --- |
| Instruction field | Plain text area. Writes `{"messages":[{"role":"user","content":"<text>"}]}`. No selectors. | `web/packages/agenta-automation-ui/src/AutomationInstructionField.tsx:94-101`, `web/packages/agenta-entities/src/gatewayTrigger/core/messageInputs.ts:100-118` |
| Template helpers | `compileMessageTemplate`, `parseMessageTemplate` exist, tested, no caller. | `web/packages/agenta-entities/src/gatewayTrigger/core/eventMessageTemplate.ts:66-139` |
| Context | `attributes` is the Composio payload. | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:93-118` |
| Inputs | Only what the mapping names. | `dispatcher.py:316-319`, `sdks/python/agenta/sdk/utils/resolvers.py:139-171` |
| Agent reads | Only `inputs.messages`. | `sdks/python/agenta/sdk/agents/handler.py:479` |
| Text parts | `ContentBlock.text` is `Optional[str]`. An int or dict fails validation; `None` passes and sends an empty part. | `sdks/python/agenta/sdk/agents/dtos.py:394, 443-447` |
| Runner | Joins text blocks with no separator. | `services/runner/src/protocol.ts:1066-1075` |
| Storage | `data` is one JSON column, dumped with `exclude_none=True`. | `api/oss/src/dbs/postgres/shared/dbas.py:214-220`, `api/oss/src/dbs/postgres/triggers/mappings.py:55, 82, 111` |
| Delivery | Stores resolved `inputs`, not the raw event. | `api/oss/src/core/triggers/dtos.py:380-397` |
| Catalog | `GET .../integrations/{integration_key}/events/{event_key}` returns `payload`. A frontend query for it exists. | `api/oss/src/apis/fastapi/triggers/router.py:217-223, 943-995`, `web/packages/agenta-entities/src/gatewayTrigger/hooks/useTriggerEvent.ts:12-42` |
| Run now | Sends the joined instruction text in a new chat. | `web/mobile/src/features/automations/AutomationTestRunButton.tsx:39-42, 59` |

How the frontend parts map to backend ideas, for the reader who knows Python:

- `@agenta/entities` is like the `core` layer: types (zod schemas, like Pydantic models) and
  pure functions. It has unit tests with vitest, like pytest.
- `@agenta/entity-ui` is a library of reusable UI components, like a shared template library.
- `@agenta/automation-ui` is the automation feature: the screens' parts and their state.
- A React component is a function from props to UI. A hook (`useX`) is a function a component
  calls to read state or start a query; think of it as a dependency the framework injects.
- A "draft" is the unsaved form state held in memory until Save. It is like a request body
  object that the screen builds up field by field.

## Goals / Non-Goals

Goals:

- The agent of every event automation gets the event data, with no edit by the user.
- On `/m`, a user can put named event fields into the instruction without writing selectors.
- The user can see what the agent will get, with real values when a delivery exists.

Non-Goals:

- Schedules. A schedule has no event payload worth showing.
- The classic app under `/w` (playground trigger section, `RunSubscriptionButton`).
- A raw JSON editor for the mapping.
- An escape syntax for typed text that starts with `$` or `/` (a known limit, see Risks).
- Adding `include_event` to the builder agent's `create_subscription` tool schema. Agents get
  the default.
- Field cards from delivered keys. Cards come from the schema only.

## Decisions

### 1. Name and place of the option

| Option | Trade-off |
| --- | --- |
| **`data.include_event: bool = True`** | Sits next to `inputs_fields`, which it changes. `include_` is the repo's word for "add this to the result" (`include_archived`). Needs no migration. Breaks the "booleans are `is_<adjective>`" rule, which the repo applies to state in `flags`. This is config, not state. |
| `data.attach_event` | Same place. "Attach" already means file attachments in chat (`ContentBlock` type `attachment`, `dtos.py:393`). One word would have two meanings. |
| `flags.is_event_included` | Follows the `flags` naming rule. But `flags` holds run state (`is_active`, `is_valid`, `is_test`), set by the user switch or by the system. This option is how the inputs are built. A reader looking for mapping config looks in `data`. |
| `data.event: {include: true}` | Room for more options later. No second option is planned, so the nesting adds a level for nothing. |

Classification (design-interfaces): role is config of the mapping. Owner is the user. It
changes per subscription, when the user edits it. Not a credential, not routing.

### 2. Default for new and old automations

| Option | Trade-off |
| --- | --- |
| **`True` as the field default; absent means on** | Old rows have no key, so they read `True`. Old automations start to work. No backfill. |
| Default off, backfill on | Needs a data migration for the same result. |
| `Optional[bool] = None`, `None` means on | Three states for one switch. The frontend must treat `null` and `undefined` both as on. |

### 3. Where the event goes in the agent's inputs

| Option | Trade-off |
| --- | --- |
| **Append to the last user message** | The runner takes the tail user message as the turn (`services/runner/src/protocol.ts:1077-1086`), so the agent reads the instruction and the event together. A string content stays a string; a list content gets one more text part. |
| A second user message after the instruction | The instruction becomes history, not the current turn. Some harnesses treat it as prior context. |
| A system message | `system` messages go to `AGENTS.md` text (`dtos.py:1715-1730`), not to the turn. The event is turn data, not standing instruction. |
| A sibling input key (`inputs.event`) | The agent handler never reads it (`handler.py:479`). This is today's broken workaround. |

The shape rules, applied to the resolved inputs:

| Resolved inputs | Result |
| --- | --- |
| `messages` list, last message has `role: "user"` | Event text appended to that message. |
| `messages` list, last message is not a user message | A new user message with the event text is appended. |
| `{}` (no mapping keys) | `{"messages":[{"role":"user","content":"<event text>"}]}`. |
| Anything else (a completion mapping such as `{"number": 42}`, or the whole-context `"$"` mapping) | Unchanged. The `"$"` mapping already carries the event. A completion mapping names its own inputs. |

The event text is built from two values of the event context block: `event_type` for the
header and `attributes` for the JSON. It does not hold the other keys of the block.

Event text (agent-facing, shown in the run transcript):

~~~text

Event data (GITHUB_PULL_REQUEST_EVENT):
```json
{
  "action": "opened",
  "number": 42,
  "title": "Fix the login page"
}
```
~~~

- It starts with a blank line, because the runner joins text blocks with no separator. The
  exact string is `"\n\nEvent data (<event_type>):\n```json\n" + <json> + "\n```"`, with no
  trailing newline.
- The JSON is `json.dumps(attributes, indent=2, ensure_ascii=False, default=str)`.
- When `event_type` is absent, the header is `Event data:`.
- When the event text is a message of its own (the `{}` case and the "last message is not a
  user message" case), the two leading newlines are dropped.

### 4. Size of the event text

| Option | Trade-off |
| --- | --- |
| **No cap in this change** | Less code on both sides: the Python and TypeScript formats stay one header and one JSON block. The whole-context `"$"` mapping already sends the full payload with no cap today. No recorded payload shows a size problem yet. |
| Cut the JSON at a fixed number of characters | Protects the model context from one very large payload. Adds a rule, a note line and a test on both sides, and the cut JSON is not valid JSON. |
| Drop large fields | Needs rules per field. More code for a case not seen yet. |

QA records one real payload and its size (task 12.1). A cap is added in a later change if a
real payload is too large.

### 5. Text coercion after resolution

The resolver replaces a whole leaf with its value, so a pill on a number gives `text: 42`, on
an object gives a dict, and on an absent key gives `None`. Pydantic rejects the number and the
dict in the agent handler, so the run fails. `None` passes and sends an empty part (verified
with a script; see the research file). A pull request number is a common field, so this is
needed now.

| Option | Trade-off |
| --- | --- |
| **The dispatcher coerces each message `content` and each text part `text` to a string** | One place, before the request is built and before the delivery is written. |
| Coerce in the SDK handler | Fixes it for every caller, but the runner and services can run a different SDK version than the API. The API fix works at once. |
| Make the frontend refuse pills on non-string fields | The schema can be wrong, and absent keys still give `None`. |

The text rule, used by the dispatcher and by the frontend preview, so both give the same text:

| Resolved value | Text |
| --- | --- |
| A string | The string, unchanged. |
| `None` (absent or null) | `""` |
| Anything else (number, boolean, object, list) | Compact JSON: `json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)` in Python, `JSON.stringify(value)` in TypeScript. `42` gives `42`, `true` gives `true`. |

Coercion runs for subscriptions only, whether `include_event` is on or off. It touches only the
`messages` list. Schedules keep today's inputs: their messages are static text, and schedules
are out of scope.

### 6. Recording the event on the delivery

The preview needs real values. A delivery stores only resolved inputs.

| Option | Trade-off |
| --- | --- |
| **`TriggerDeliveryData.event: Optional[Dict[str, Any]]` = the context's `event` block** | The selector `$.event.attributes.title` resolves against `{event: delivery.data.event}` with no change. No migration. Stores the payload once more per delivery. |
| Show the newest delivery's `data.inputs` as it is | Needs no new field. But the preview cannot follow an edit of the instruction, and when the option is off the inputs hold only the pill values, not the other fields. |
| Parse the event JSON back out of the included text | Breaks when the option is off. Couples the screen to a text format. |
| No real values in the preview | The user cannot see a schema mismatch until the agent fails. |

`data.event` holds the normalized event context block (`event_id`, `event_type`, `timestamp`,
`created_at`, `attributes`), not the raw provider body. The provider's `payload` is under
`attributes`.

Set on subscription deliveries only (real runs, refusals that have the event, and test
captures). Schedules have a synthetic event; they keep `event` absent.

### 7. Where the field cards come from

| Option | Trade-off |
| --- | --- |
| **The catalog payload schema** | Available before the first event. Carries the provider's `description`. The query exists. |
| Keys of the newest delivery | Real keys, but empty until the first event, and no descriptions. |
| Both, merged | Handles a schema mismatch, but adds merge rules before we know a mismatch happens. |

Card rules:

- One card per property of `payload.properties`, in schema order.
- A property of type `object` with its own `properties` is a group: the group shows its
  humanized name and one card per child property. Deeper objects are one card each.
- An array is one card.
- Label: split camelCase into words, then `humanizeActionKey` from `@agenta/shared/utils`
  (`web/packages/agenta-shared/src/utils/toolSlug.ts:67-81`). `createdBy` reads "Created by",
  `htmlUrl` reads "Html URL". A child label is the parent and child words together:
  `data.title` reads "Data title". No hand-written label map.
- Description: the property's `description`, as the provider wrote it. No description: no line.
- Selector: `$.event.attributes.<key>`, or `$.event.attributes["<key>"]` when the key is not
  letters, digits and underscores.
- A card shows a check when the template already has its selector.
- No schema, or an empty `properties`: no cards. The checkbox and the preview still show.

### 8. Run now

Run now opens a new chat with the instruction. It has no event of its own.

| Option | Trade-off |
| --- | --- |
| **Send the preview text. The preview fills pills from the newest delivery's event and adds the event text when the option is on. With no delivery, each pill becomes its label in square brackets.** | One function builds the text for the preview and for Run now, so Run now sends what the preview shows. The user tests with real data when it exists. Today Run now sends the joined text, which would hold raw selectors once pills exist, so a change is needed now. |
| Send pills as raw selectors | The agent reads `$.event.attributes.title`. Wrong. |
| Block Run now until a delivery exists | A new automation cannot be tried at all. |

The frontend builds the text with the same rules as the dispatcher:

- Pill values follow the text rule of decision 5.
- The header reads `event_type` from the delivery's `data.event`, the same value the dispatcher
  uses, not the automation's event key.
- The frontend lookup keeps a quoted key whole: `$.event.attributes["a.b"]` reads the key
  `a.b`. Today `resolveSelectorPreview` splits it into `a` and `b`
  (`web/packages/agenta-entities/src/gatewayTrigger/core/selectorPreview.ts:34-38`); this
  change fixes that.

Two limits on Run now:

- **A mapping the composer cannot show** (several messages, a non-user message, a non-text
  part; see decision 10) is not built by the new function. The preview shows only today's
  warning line, and Run now sends today's text (`getScheduleMessagePreview` of the stored
  inputs). This keeps today's behavior for agent-made mappings and avoids a second general
  message builder in the frontend. `parseMessageTemplate` must tell this case apart from an
  empty instruction.
- **The newest event is read when the user presses Run now**, with one awaited call to
  `queryTriggerDeliveries`. A pure function, `latestDeliveryEvent(deliveries)`, picks the
  newest delivery that has `data.event`. The preview calls the same function on the rows of
  `useAutomationRuns`, so the rule lives in one place. Both entry points (the detail button and the
  list menu) do this, so neither starts a run while the deliveries are still loading, and the
  list does not run one deliveries query per row. Labels in square brackets are used only when
  the call succeeds and finds no delivery with `data.event`. When the call fails, Run now does
  not start, logs the error and stays enabled, so the user can press it again. This adds no new
  UI text.

This is a contract for the selectors the cards make, not a general JSON Path engine. Both
sides have tests with the same fixtures: the event text example of decision 3, a string, a
number, a boolean, an object, an absent key, and a quoted key.

### 9. Where the frontend code lives

| Part | Package | Why |
| --- | --- | --- |
| zod fields, schema-to-cards, labels, used-field check, preview text, event text | `@agenta/entities/gatewayTrigger/core` | Pure functions next to `eventMessageTemplate.ts`. Unit tests with vitest. |
| `EventMessageComposer` (pill editor), `EventFieldCards` | `@agenta/entity-ui/gatewayTrigger/drawers/subscription/` | Reusable UI in the folder where the old `PillEditor.tsx` lived; it comes back from `89c2d80c39^`. `MessageComposer` stays in `drawers/schedule/`. |

Why a restored `PillEditor.tsx` and two new components, not a larger `MessageComposer`:
`MessageComposer` is a plain text area. Today it serves every automation kind; after this change it serves schedules only. A pill is one unit that the cursor skips
and Backspace removes whole, which a text area cannot do. Putting pills into `MessageComposer`
would add an event mode to the schedule editor. `PillEditor.tsx` already did this job before
`89c2d80c39`, so restoring it is less new code than writing an editor. The parent keeps the
draft; the components only show it and report changes.
| Instruction field wiring, drafts, payload builders | `@agenta/automation-ui` | The feature that owns the automation screens. |
| Run now | `web/mobile/src/features/automations/` | The button is a `/m` app component today. |

### 10. Reading and writing the mapping

`parseMessageTemplate` returns `""` when the mapping has any key other than the message
(`eventMessageTemplate.ts:126-138`). A builder agent's mapping often has a sibling `event` key,
so the screen would show an empty box and Save would drop that key.

Decision: `parseMessageTemplate` reads the message and ignores other keys. It returns
`string | null`: `null` means the composer cannot show the mapping, the same meaning
`contentToTemplate` gives `null` (`eventMessageTemplate.ts:84`). `compileMessageTemplate` has
no caller today, so it changes in place instead of getting a second writer next to it: it takes
the stored `inputsText`, replaces only the message key and keeps the rest, the same rule
`setScheduleMessage` follows (`messageInputs.ts:100-118`). One function writes a template into
a mapping. A mapping the composer cannot show (several messages, a non-user message, a non-text
part) keeps today's warning line and is replaced only when the user types.

The Instruction field also moves the message when the agent's input shape resolves late
(`remapMessageShape`, `messageInputs.ts:132-143`, called from
`AutomationInstructionField.tsx:62-77`). That helper reads plain text only, so a text with a
pill typed before a chat agent resolves would stay under the old key, where the agent does not
read it. For event automations, a new `remapMessageTemplate(inputsText, prev, next)` does the
same move with `parseMessageTemplate` and `compileMessageTemplate`: it removes the old key,
keeps sibling keys, and leaves a mapping it cannot show untouched. Schedules keep
`remapMessageShape`.

### 11. Builder agent reference text

| Option | Trade-off |
| --- | --- |
| **Fix `_TRIGGER_INPUTS_REFERENCE` in this change** | A text edit. Today the text tells builder agents to add a sibling `event` key that the agent handler never reads, so every agent-made automation gets a mapping that does not work. The fix stops new broken mappings now. |
| Fix it in a later change | Builder agents keep making the broken mapping until then. With `include_event` on, those runs still get the event, but the mapping carries a dead key. |

## Risks / Trade-offs

- **The delivered keys may not match the schema.** Not verified: no real delivery is on record
  in the repo or the local databases. If a key differs, its pill gives an empty string, and the
  included event still carries the real key. QA records one real GitHub payload and compares.
- **Old automations change behavior.** Their agents start to get the event text. That is the
  fix, but a prompt that depended on not seeing it may act differently. The user can turn the
  option off.
- **The transcript shows the event JSON.** The included text is part of the user message, so the
  session view shows it. This is honest about what the agent got.
- **Storage.** Each subscription delivery stores the payload in `data.event`, and, when the
  option is on, a second copy inside `data.inputs`. Composio payloads are small JSON objects.
  No cap on the stored copy.
- **Typed text that starts with `$` or `/`** is read as a selector by the resolver, today and
  after this change (`resolvers.py:128-133`). Recorded as a known limit.
- **Two copies of the text rules** (Python and TypeScript): the event text format and the pill
  value rule. Pinned by the same fixtures in both test suites (decision 8).
- **A very large payload** goes to the agent in full, with no cap (decision 4).
- **Version skew.** The SDK reference text ships with the SDK. The dispatcher change ships with
  the API. Neither depends on the other.

## Migration

- No schema migration. `data` is a JSON column on both tables.
- Old subscriptions read `include_event = True`.
- Old deliveries have no `event`. The preview falls back to field labels for them.
- Rollback: revert the API image. Rows written with `include_event` or `event` still read on
  the old code, because `TriggerSubscriptionData` and `TriggerDeliveryData` ignore unknown keys
  (Pydantic default). Check this in the backend tasks.
